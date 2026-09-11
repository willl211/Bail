import request from 'supertest';
import { PropertyStatus, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createProperty, createUser, TEST_PASSWORD } from './fixtures';

describe('Contrôle des diagnostics par les agents', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());
  const login = async (email: string) =>
    sessionCookie(
      await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200),
    );
  const valid = {
    decision: 'VERIFY',
    issuedAt: '2026-01-10',
    expiresAt: '2030-01-10',
    energyRating: 'C',
  };

  async function ready() {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const agent = await createUser(h.prisma, UserRole.AGENT);
    const ownerCookie = await login(owner.email);
    const agentCookie = await login(agent.email);
    const property = await createProperty(h.prisma, owner.id, { status: PropertyStatus.DRAFT });
    const upload = (name = 'dpe.pdf') =>
      api()
        .post(`/api/v1/owner/properties/${property.reference}/documents`)
        .set('Cookie', ownerCookie)
        .field('type', 'DPE')
        .attach('file', Buffer.from('%PDF-1.4\nDiagnostic test'), {
          filename: name,
          contentType: 'application/pdf',
        });
    const document = (await upload().expect(201)).body as { id: string };
    const submit = () =>
      api()
        .post(`/api/v1/owner/properties/${property.reference}/submit`)
        .set('Cookie', ownerCookie)
        .expect(201);
    await submit();
    const current = () => h.prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    const review = async (payload: object = valid, revision?: number) =>
      api()
        .post(`/api/v1/admin/property-documents/${document.id}/decision`)
        .set('Cookie', agentCookie)
        .send({ ...payload, expectedRevision: revision ?? (await current()).reviewRevision });
    const decide = async (decision: 'PUBLISH' | 'REJECT', reason?: string, revision?: number) =>
      api()
        .post(`/api/v1/admin/properties/${property.reference}/decision`)
        .set('Cookie', agentCookie)
        .send({ decision, reason, expectedRevision: revision ?? (await current()).reviewRevision });
    return {
      owner,
      agent,
      ownerCookie,
      agentCookie,
      property,
      document,
      upload,
      submit,
      current,
      review,
      decide,
    };
  }

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
  });

  it('accepte un dépôt en attente mais exige un DPE vérifié pour publier, avec auteur et version conservés', async () => {
    const c = await ready();
    expect((await c.current()).status).toBe('PENDING_REVIEW');
    const before = (await c.current()).reviewRevision;
    const blocked = await c.decide('PUBLISH');
    expect(blocked.status).toBe(400);
    expect(blocked.body.blockers.join(' ')).toContain('DPE à valider');
    expect((await c.review()).status).toBe(200);
    const document = await h.prisma.propertyDocument.findUniqueOrThrow({
      where: { id: c.document.id },
    });
    expect(document.status).toBe('VERIFIED');
    expect(document.verifiedAt).not.toBeNull();
    expect(document.expiresAt?.toISOString()).toBe('2030-01-10T23:59:59.999Z');
    const event = await h.prisma.propertyReviewEvent.findFirstOrThrow({
      where: { action: 'DOCUMENT_VERIFIED' },
    });
    expect(event.actorId).toBe(c.agent.id);
    expect(event.snapshot).toMatchObject({
      documentId: document.id,
      reviewedRevision: before,
      energyRating: 'C',
    });
    expect((await c.decide('PUBLISH', undefined, before)).status).toBe(409);
    expect((await c.decide('PUBLISH')).status).toBe(200);
    expect((await c.current()).status).toBe('ONLINE');
    const journal = await api()
      .get('/api/v1/admin/journal')
      .set('Cookie', c.agentCookie)
      .expect(200);
    expect(
      journal.body.some((event: { title: string }) => event.title.includes('Diagnostic validé')),
    ).toBe(true);
  });

  it('réserve la consultation privée aux agents et refuse une version périmée', async () => {
    const c = await ready();
    const path = `/api/v1/admin/property-documents/${c.document.id}/file`;
    await api().get(path).expect(401);
    await api().get(path).set('Cookie', c.ownerCookie).expect(403);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    await api()
      .get(path)
      .set('Cookie', await login(tenant.email))
      .expect(403);
    const response = await api().get(path).set('Cookie', c.agentCookie).expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-type']).toContain('application/pdf');
    await api().get(`${path}?revision=1`).set('Cookie', c.agentCookie).expect(409);
    await api()
      .post(`/api/v1/admin/property-documents/${c.document.id}/decision`)
      .set('Cookie', c.ownerCookie)
      .send({ ...valid, expectedRevision: 3 })
      .expect(403);
  });

  it.each([
    ['dates absentes', { decision: 'VERIFY', energyRating: 'C' }],
    ['date inexistante', { ...valid, issuedAt: '2026-02-30' }],
    ['réalisation future', { ...valid, issuedAt: '2099-01-01' }],
    ['DPE expiré', { ...valid, expiresAt: '2020-01-01' }],
    ['classe différente', { ...valid, energyRating: 'D' }],
    ['classe non confirmée', { ...valid, energyRating: undefined }],
    ['refus sans motif', { decision: 'REJECT', reason: '   ' }],
  ])('refuse une décision invalide : %s', async (_name, payload) => {
    const c = await ready();
    expect((await c.review(payload)).status).toBe(400);
    expect(
      (await h.prisma.propertyDocument.findUniqueOrThrow({ where: { id: c.document.id } })).status,
    ).toBe('PENDING');
    expect(
      await h.prisma.propertyReviewEvent.count({
        where: { action: { in: ['DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED'] } },
      }),
    ).toBe(0);
  });

  it('ne valide pas un fichier absent du stockage', async () => {
    const c = await ready();
    await h.prisma.propertyDocument.update({
      where: { id: c.document.id },
      data: { storageKey: 'missing/file.pdf' },
    });
    const response = await c.review();
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Fichier indisponible');
  });

  it('conserve le refus après remplacement et remet les dates et la validation à zéro', async () => {
    const c = await ready();
    expect((await c.review()).status).toBe(200);
    expect(
      (await c.review({ decision: 'REJECT', reason: 'Adresse du logement illisible' })).status,
    ).toBe(200);
    expect((await c.decide('REJECT', 'Remplacez le DPE illisible')).status).toBe(200);
    const ownerView = await api()
      .get(`/api/v1/owner/properties/${c.property.reference}`)
      .set('Cookie', c.ownerCookie)
      .expect(200);
    expect(ownerView.body.documents[0].rejectionReason).toBe('Adresse du logement illisible');
    expect(ownerView.body.reviewNote).toBe('Remplacez le DPE illisible');
    const stale = (await c.current()).reviewRevision;
    expect((await c.upload('nouveau-dpe.pdf')).status).toBe(201);
    const replaced = await h.prisma.propertyDocument.findUniqueOrThrow({
      where: { id: c.document.id },
    });
    expect(replaced).toMatchObject({
      status: 'PENDING',
      expiresAt: null,
      verifiedAt: null,
      rejectionReason: null,
    });
    await c.submit();
    expect((await c.review(valid, stale)).status).toBe(409);
    const history = await h.prisma.propertyReviewEvent.findMany({
      where: { propertyId: c.property.id },
    });
    expect(history.some((event) => event.note.includes('Adresse du logement illisible'))).toBe(
      true,
    );
    expect(
      history.some(
        (event) => event.action === 'DOCUMENT_UPLOADED' && event.note.includes('nouveau-dpe.pdf'),
      ),
    ).toBe(true);
  });

  it('invalide les diagnostics si les caractéristiques du logement changent, mais pas pour une sauvegarde identique', async () => {
    const c = await ready();
    expect((await c.review()).status).toBe(200);
    await c.decide('REJECT', 'Complétez la description');
    const path = `/api/v1/owner/properties/${c.property.reference}`;
    await api().patch(path).set('Cookie', c.ownerCookie).send({ energyRating: 'C' }).expect(200);
    expect(
      (await h.prisma.propertyDocument.findUniqueOrThrow({ where: { id: c.document.id } })).status,
    ).toBe('VERIFIED');
    await api().patch(path).set('Cookie', c.ownerCookie).send({ energyRating: 'D' }).expect(200);
    expect(
      (await h.prisma.propertyDocument.findUniqueOrThrow({ where: { id: c.document.id } })).status,
    ).toBe('PENDING');
    await c.submit();
    expect((await c.decide('PUBLISH')).status).toBe(400);
  });

  it('empêche deux agents de décider sur la même version', async () => {
    const c = await ready();
    const revision = (await c.current()).reviewRevision;
    const responses = await Promise.all([
      c.review(valid, revision),
      c.review({ decision: 'REJECT', reason: 'Incohérence relevée' }, revision),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await h.prisma.propertyReviewEvent.count({
        where: { action: { in: ['DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED'] } },
      }),
    ).toBe(1);
  });

  it('bloque la publication quand un DPE précédemment vérifié a expiré', async () => {
    const c = await ready();
    await c.review();
    await h.prisma.propertyDocument.update({
      where: { id: c.document.id },
      data: { expiresAt: new Date('2020-01-01') },
    });
    expect((await c.decide('PUBLISH')).status).toBe(400);
  });
});
