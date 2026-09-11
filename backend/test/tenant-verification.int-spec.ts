import { jest } from '@jest/globals';
import request from 'supertest';
import { DocumentStatus, DocumentType, TenantFileStatus, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createProperty, createUser, createVerifiedFile, TEST_PASSWORD } from './fixtures';
import {
  VERIFICATION_DRIVER,
  type VerificationDriver,
  type VerificationOutcome,
} from '../src/modules/verification/verification.driver';

describe('Dossier locataire : versions, contrôles et confidentialité', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());
  const login = async (email: string) =>
    sessionCookie(
      await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200),
    );
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function ready(status: TenantFileStatus = TenantFileStatus.SUBMITTED) {
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    const agent = await createUser(h.prisma, UserRole.AGENT);
    const original = await createVerifiedFile(h.prisma, tenant.id);
    const file = await h.prisma.tenantFile.update({
      where: { id: original.id },
      data: {
        status,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
        verifiedRevision: status === 'VERIFIED' ? 1 : null,
      },
    });
    return {
      tenant,
      agent,
      file,
      tenantCookie: await login(tenant.email),
      agentCookie: await login(agent.email),
    };
  }

  it('lie la validation à une version, un agent et un instantané conservé après modification', async () => {
    const { tenant, agent, file, tenantCookie, agentCookie } = await ready();
    const pending = await api().get('/api/v1/tenant/file').set('Cookie', tenantCookie).expect(200);
    expect(pending.body.incomeVerified).toBe(false);
    expect(pending.body.groups.income).toBe('PENDING');
    await api()
      .post(`/api/v1/admin/tenant-files/${file.reference}/decision`)
      .set('Cookie', agentCookie)
      .send({ decision: 'VERIFY', expectedRevision: 1 })
      .expect(200);
    const verified = await api().get('/api/v1/tenant/file').set('Cookie', tenantCookie).expect(200);
    expect(verified.body).toMatchObject({
      status: 'VERIFIED',
      revision: 2,
      verifiedRevision: 2,
      incomeVerified: true,
    });
    const event = await h.prisma.tenantFileEvent.findFirstOrThrow({
      where: { tenantFileId: file.id, action: 'FILE_VERIFIED' },
    });
    expect(event.actorId).toBe(agent.id);
    expect(event.actorLabel).toBe(`${agent.firstName} ${agent.lastName}`);
    expect(event.snapshot).toMatchObject({
      reviewedRevision: 1,
      profile: { netMonthlyIncomeCents: 300_000 },
    });
    await api()
      .patch('/api/v1/tenant/file')
      .set('Cookie', tenantCookie)
      .send({ netMonthlyIncomeCents: 900_000 })
      .expect(200);
    const unchangedEvent = await h.prisma.tenantFileEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(unchangedEvent.snapshot).toEqual(event.snapshot);
    const changed = await h.prisma.tenantFile.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(changed).toMatchObject({
      status: 'SUBMITTED',
      verifiedAt: null,
      verifiedRevision: null,
      revision: 3,
    });
  });

  it.each([
    { netMonthlyIncomeCents: 900_000 },
    { employerName: 'Nouvel employeur' },
    { inProbationPeriod: true },
    { contractType: 'CDD' },
  ])('retire les contrôles concernés après modification %j', async (payload) => {
    const { file, tenantCookie } = await ready(TenantFileStatus.VERIFIED);
    const response = await api()
      .patch('/api/v1/tenant/file')
      .set('Cookie', tenantCookie)
      .send(payload)
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'SUBMITTED',
      verifiedAt: null,
      verifiedRevision: null,
      incomeVerified: false,
      revision: 2,
    });
    expect(response.body.groups.income).toBe('PENDING');
    const identity = await h.prisma.tenantDocument.findFirstOrThrow({
      where: { tenantFileId: file.id, type: DocumentType.ID_CARD },
    });
    expect(identity.status).toBe('VERIFIED');
  });

  it('garde la validation quand le formulaire renvoie exactement les mêmes valeurs', async () => {
    const { file, tenantCookie } = await ready(TenantFileStatus.VERIFIED);
    const response = await api()
      .patch('/api/v1/tenant/file')
      .set('Cookie', tenantCookie)
      .send({
        netMonthlyIncomeCents: file.netMonthlyIncomeCents,
        contractType: file.contractType,
        employerName: file.employerName,
      })
      .expect(200);
    expect(response.body).toMatchObject({ status: 'VERIFIED', incomeVerified: true, revision: 1 });
    expect(await h.prisma.tenantFileEvent.count()).toBe(0);
  });

  it('expose les mêmes blocages à l’admin et au locataire quand un bulletin est refusé', async () => {
    const { file, tenantCookie, agentCookie } = await ready();
    await h.prisma.tenantDocument.create({
      data: {
        tenantFileId: file.id,
        type: DocumentType.PAYSLIP,
        status: DocumentStatus.REJECTED,
        rejectionReason: 'Illisible',
      },
    });
    const tenant = await api().get('/api/v1/tenant/file').set('Cookie', tenantCookie).expect(200);
    const admin = await api()
      .get('/api/v1/admin/tenant-files')
      .set('Cookie', agentCookie)
      .expect(200);
    expect(tenant.body.verifiedSlotCount).toBe(4);
    expect(admin.body[0].verifiedCount).toBe(4);
    expect(admin.body[0].missingLabels).toContain('Bulletins de salaire');
    await api()
      .post(`/api/v1/admin/tenant-files/${file.reference}/decision`)
      .set('Cookie', agentCookie)
      .send({ decision: 'VERIFY', expectedRevision: 1 })
      .expect(400);
    expect(await h.prisma.tenantFileEvent.count()).toBe(0);
  });

  it('refuse une validation sans revenu renseigné, même si toutes les pièces sont vertes', async () => {
    const { file, agentCookie } = await ready();
    await h.prisma.tenantFile.update({
      where: { id: file.id },
      data: { netMonthlyIncomeCents: null },
    });
    const response = await api()
      .post(`/api/v1/admin/tenant-files/${file.reference}/decision`)
      .set('Cookie', agentCookie)
      .send({ decision: 'VERIFY', expectedRevision: 1 })
      .expect(400);
    expect(response.body.blockers).toContain('Revenus mensuels — à renseigner');
  });

  it('refuse la décision d’une page admin devenue obsolète', async () => {
    const { file, tenantCookie, agentCookie } = await ready();
    await api()
      .patch('/api/v1/tenant/file')
      .set('Cookie', tenantCookie)
      .send({ netMonthlyIncomeCents: 900_000 })
      .expect(200);
    await api()
      .post(`/api/v1/admin/tenant-files/${file.reference}/decision`)
      .set('Cookie', agentCookie)
      .send({ decision: 'VERIFY', expectedRevision: 1 })
      .expect(409);
    await api()
      .post(`/api/v1/admin/tenant-files/${file.reference}/decision`)
      .set('Cookie', agentCookie)
      .send({ decision: 'VERIFY' })
      .expect(400);
    expect(await h.prisma.tenantFileEvent.count({ where: { action: 'FILE_VERIFIED' } })).toBe(0);
  });

  it('n’enregistre qu’une validation pour deux décisions simultanées', async () => {
    const { file, agentCookie } = await ready();
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        api()
          .post(`/api/v1/admin/tenant-files/${file.reference}/decision`)
          .set('Cookie', agentCookie)
          .send({ decision: 'VERIFY', expectedRevision: 1 }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await h.prisma.tenantFileEvent.count({ where: { action: 'FILE_VERIFIED' } })).toBe(1);
  });

  it('ne valide pas de nouveaux revenus lors d’une modification simultanée à la décision', async () => {
    const { file, tenantCookie, agentCookie } = await ready();
    const responses = await Promise.all([
      api()
        .post(`/api/v1/admin/tenant-files/${file.reference}/decision`)
        .set('Cookie', agentCookie)
        .send({ decision: 'VERIFY', expectedRevision: 1 }),
      api()
        .patch('/api/v1/tenant/file')
        .set('Cookie', tenantCookie)
        .send({ netMonthlyIncomeCents: 900_000 }),
    ]);
    expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
    const current = await h.prisma.tenantFile.findUniqueOrThrow({ where: { id: file.id } });
    if (current.netMonthlyIncomeCents === 900_000) expect(current.status).not.toBe('VERIFIED');
    const event = await h.prisma.tenantFileEvent.findFirst({ where: { action: 'FILE_VERIFIED' } });
    if (event)
      expect(event.snapshot).toMatchObject({ profile: { netMonthlyIncomeCents: 300_000 } });
  });

  it('conserve le verrou du contrôle en cours pour les modifications et retraits', async () => {
    const { file, tenantCookie } = await ready(TenantFileStatus.UNDER_REVIEW);
    const document = await h.prisma.tenantDocument.findFirstOrThrow({
      where: { tenantFileId: file.id },
    });
    await api()
      .patch('/api/v1/tenant/file')
      .set('Cookie', tenantCookie)
      .send({ netMonthlyIncomeCents: 900_000 })
      .expect(409);
    await api()
      .delete(`/api/v1/tenant/file/documents/${document.id}`)
      .set('Cookie', tenantCookie)
      .expect(409);
    expect(await h.prisma.tenantDocument.count()).toBe(5);
    expect(await h.prisma.tenantFileEvent.count()).toBe(0);
  });

  it('n’écrase pas une invalidation par le retour tardif du prestataire', async () => {
    const { file, tenantCookie } = await ready();
    await h.prisma.tenantDocument.deleteMany({ where: { tenantFileId: file.id, type: 'EMPLOYMENT_CONTRACT' } });
    let release!: (outcome: VerificationOutcome) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest
      .spyOn(h.app.get<VerificationDriver>(VERIFICATION_DRIVER), 'verify')
      .mockImplementationOnce(() => {
        entered();
        return new Promise((resolve) => {
          release = resolve;
        });
      });
    const upload = api()
      .post('/api/v1/tenant/file/documents')
      .set('Cookie', tenantCookie)
      .field('type', 'EMPLOYMENT_CONTRACT')
      .attach('file', Buffer.from('%PDF-1.4\nDocument de test'), {
        filename: 'bulletin.pdf',
        contentType: 'application/pdf',
      })
      .then((response) => response);
    await started;
    try {
      await api()
        .patch('/api/v1/tenant/file')
        .set('Cookie', tenantCookie)
        .send({ netMonthlyIncomeCents: 900_000 })
        .expect(200);
    } finally {
      release({ status: 'verified', note: 'Ancien résultat' });
    }
    expect((await upload).status).toBe(201);
    const document = await h.prisma.tenantDocument.findFirstOrThrow({
      where: { tenantFileId: file.id, fileName: 'bulletin.pdf' },
    });
    expect(document.status).toBe('PENDING');
    expect(document.verificationNote).not.toBe('Ancien résultat');
  });

  it('retire les anciennes pièces lorsque l’identité du garant change', async () => {
    const { file, tenantCookie } = await ready(TenantFileStatus.VERIFIED);
    await h.prisma.guarantor.create({
      data: {
        tenantFileId: file.id,
        firstName: 'Jean',
        lastName: 'Dupont',
        netMonthlyIncomeCents: 400_000,
      },
    });
    await h.prisma.tenantDocument.createMany({
      data: [DocumentType.GUARANTOR_ID, DocumentType.GUARANTOR_INCOME].map((type) => ({
        tenantFileId: file.id,
        type,
        status: DocumentStatus.VERIFIED,
      })),
    });
    const response = await api()
      .put('/api/v1/tenant/file/guarantor')
      .set('Cookie', tenantCookie)
      .send({
        kind: 'INDIVIDUAL',
        firstName: 'Marie',
        lastName: 'Dupont',
        netMonthlyIncomeCents: 400_000,
      })
      .expect(200);
    expect(response.body).toMatchObject({ status: 'SUBMITTED', verifiedRevision: null });
    expect(response.body.groups.guarantor).toBe('MISSING');
    expect(
      await h.prisma.tenantDocument.count({
        where: { type: { in: [DocumentType.GUARANTOR_ID, DocumentType.GUARANTOR_INCOME] } },
      }),
    ).toBe(0);
  });

  it('relance le contrôle des pièces du garant après un changement de revenus', async () => {
    const { file, tenantCookie } = await ready(TenantFileStatus.VERIFIED);
    await h.prisma.guarantor.create({
      data: {
        tenantFileId: file.id,
        firstName: 'Jean',
        lastName: 'Dupont',
        netMonthlyIncomeCents: 400_000,
      },
    });
    await h.prisma.tenantDocument.createMany({
      data: [DocumentType.GUARANTOR_ID, DocumentType.GUARANTOR_INCOME].map((type) => ({
        tenantFileId: file.id,
        type,
        status: DocumentStatus.VERIFIED,
      })),
    });
    const unchanged = await api()
      .put('/api/v1/tenant/file/guarantor')
      .set('Cookie', tenantCookie)
      .send({
        kind: 'INDIVIDUAL',
        firstName: 'Jean',
        lastName: 'Dupont',
        netMonthlyIncomeCents: 400_000,
      })
      .expect(200);
    expect(unchanged.body.revision).toBe(1);
    const response = await api()
      .put('/api/v1/tenant/file/guarantor')
      .set('Cookie', tenantCookie)
      .send({
        kind: 'INDIVIDUAL',
        firstName: 'Jean',
        lastName: 'Dupont',
        netMonthlyIncomeCents: 600_000,
      })
      .expect(200);
    expect(response.body.groups.guarantor).toBe('PENDING');
    expect(response.body.status).toBe('SUBMITTED');
  });

  it('permet à l’agent de consulter une pièce, avec refus pour un propriétaire et un visiteur', async () => {
    const { tenantCookie, agentCookie } = await ready();
    const uploaded = await api()
      .post('/api/v1/tenant/file/documents')
      .set('Cookie', tenantCookie)
      .field('type', 'PAYSLIP')
      .attach('file', Buffer.from('%PDF-1.4\nDocument de test'), {
        filename: 'lecture.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const document = uploaded.body.slots
      .flatMap((slot: { documents: { id: string; fileName: string }[] }) => slot.documents)
      .find((entry: { fileName: string }) => entry.fileName === 'lecture.pdf');
    const url = `/api/v1/admin/documents/${document.id}/file`;
    await api().get(url).expect(401);
    const owner = await createUser(h.prisma, UserRole.OWNER);
    await api()
      .get(url)
      .set('Cookie', await login(owner.email))
      .expect(403);
    await api().get(url).set('Cookie', tenantCookie).expect(403);
    const response = await api().get(url).set('Cookie', agentCookie).expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-type']).toContain('application/pdf');
  });

  it('conserve l’auteur et le motif d’un refus même après le retrait de la pièce', async () => {
    const { file, tenantCookie, agentCookie, agent } = await ready();
    const document = await h.prisma.tenantDocument.findFirstOrThrow({
      where: { tenantFileId: file.id, type: DocumentType.PAYSLIP },
    });
    await api()
      .post(`/api/v1/admin/documents/${document.id}/decision`)
      .set('Cookie', agentCookie)
      .send({ decision: 'REJECT', reason: 'Montant illisible', expectedRevision: 1 })
      .expect(200);
    await api()
      .delete(`/api/v1/tenant/file/documents/${document.id}`)
      .set('Cookie', tenantCookie)
      .expect(200);
    const event = await h.prisma.tenantFileEvent.findFirstOrThrow({
      where: { action: 'DOCUMENT_REJECTED' },
    });
    expect(event.actorId).toBe(agent.id);
    expect(event.note).toContain('Montant illisible');
    const view = await api().get('/api/v1/tenant/file').set('Cookie', tenantCookie).expect(200);
    expect(
      view.body.journal.some((entry: { note: string }) => entry.note.includes('Montant illisible')),
    ).toBe(true);
  });

  it('retire le taux vérifié côté propriétaire sans exposer les pièces ou l’historique privé', async () => {
    const { file, tenant, tenantCookie } = await ready(TenantFileStatus.VERIFIED);
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    await h.prisma.application.create({
      data: {
        tenantId: tenant.id,
        tenantFileId: file.id,
        propertyId: property.id,
        incomeRatio: 0.3,
      },
    });
    const cookie = await login(owner.email);
    const initial = await api().get('/api/v1/owner/applications').set('Cookie', cookie).expect(200);
    expect(initial.body.applications[0].incomeVerified).toBe(true);
    await api()
      .patch('/api/v1/tenant/file')
      .set('Cookie', tenantCookie)
      .send({ netMonthlyIncomeCents: 900_000 })
      .expect(200);
    const response = await api()
      .get('/api/v1/owner/applications')
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body.applications[0]).toMatchObject({
      fileStatus: 'SUBMITTED',
      incomeVerified: false,
      effortRate: null,
    });
    for (const field of ['documents', 'events', 'history', 'snapshot', 'storageKey'])
      expect(response.body.applications[0]).not.toHaveProperty(field);
  });
});
