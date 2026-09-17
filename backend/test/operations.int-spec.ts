import request from 'supertest';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createProperty, createUser, createVerifiedFile, TEST_PASSWORD } from './fixtures';
import { OperationsService } from '../src/modules/operations/operations.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { hashSecret } from '../src/modules/auth/tokens';

describe('Exploitation et demandes de suppression', () => {
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
  async function fixture() {
    const user = await createUser(h.prisma, 'TENANT');
    const agent = await createUser(h.prisma, 'AGENT');
    const cookie = await login(user.email),
      admin = await login(agent.email);
    const requested = await api()
      .post('/api/v1/privacy/erasure')
      .set('Cookie', cookie)
      .send({ password: TEST_PASSWORD })
      .expect(201);
    return { user, agent, cookie, admin, id: requested.body.id as string };
  }
  it('authentifie une demande, absorbe les doublons et ne révèle pas celle d’un autre compte', async () => {
    const f = await fixture();
    const again = await api()
      .post('/api/v1/privacy/erasure')
      .set('Cookie', f.cookie)
      .send({ password: TEST_PASSWORD })
      .expect(201);
    expect(again.body.id).toBe(f.id);
    await api()
      .post('/api/v1/privacy/erasure')
      .set('Cookie', f.cookie)
      .send({ password: 'incorrect' })
      .expect(401);
    const other = await createUser(h.prisma, 'TENANT');
    const response = await api()
      .get('/api/v1/privacy/erasure')
      .set('Cookie', await login(other.email))
      .expect(200);
    expect(response.text).not.toContain(f.id);
    await api().get('/api/v1/admin/operations').set('Cookie', f.cookie).expect(403);
    await api()
      .post('/api/v1/admin/operations/erasure/' + f.id)
      .set('Cookie', f.cookie)
      .send({ action: 'ERASE', note: 'Suppression' })
      .expect(403);
  });
  it('efface un compte sans engagement après les fichiers, y compris les données dérivées', async () => {
    const f = await fixture();
    const file = await createVerifiedFile(h.prisma, f.user.id);
    const keys = await h.prisma.tenantDocument.findMany({
      where: { tenantFileId: file.id },
      select: { storageKey: true },
    });
    const removed: string[] = [];
    const storage = h.app.get(StorageService),
      original = storage.removeRequired;
    storage.removeRequired = async (_scope, key) => {
      removed.push(key);
    };
    try {
      const response = await api()
        .post('/api/v1/admin/operations/erasure/' + f.id)
        .set('Cookie', f.admin)
        .send({ action: 'ERASE', note: 'Compte sans engagement, effacement demandé.' })
        .expect(201);
      expect(response.body.status).toBe('COMPLETED');
      expect(removed.sort()).toEqual(keys.map((k) => k.storageKey).sort());
      expect(await h.prisma.user.findUnique({ where: { id: f.user.id } })).toBeNull();
      expect(await h.prisma.tenantDocument.count({ where: { tenantFileId: file.id } })).toBe(0);
      expect(await h.prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
      expect((await api().get('/api/v1/auth/me').set('Cookie', f.cookie)).body.user).toBeNull();
    } finally {
      storage.removeRequired = original;
    }
  });
  it('conserve une demande inachevée en cas de panne et permet sa reprise sans réactiver le compte', async () => {
    const f = await fixture();
    await createVerifiedFile(h.prisma, f.user.id);
    const storage = h.app.get(StorageService),
      original = storage.removeRequired;
    storage.removeRequired = async () => {
      throw new Error('Erreur privée avec un secret qui ne doit pas sortir');
    };
    try {
      const failed = await api()
        .post('/api/v1/admin/operations/erasure/' + f.id)
        .set('Cookie', f.admin)
        .send({ action: 'ERASE', note: 'Effacement demandé' })
        .expect(500);
      expect(failed.body.requestId).toMatch(/^[a-f0-9-]{36}$/);
      expect(failed.text).not.toContain('secret');
      expect(
        (await h.prisma.erasureRequest.findUniqueOrThrow({ where: { id: f.id } })).status,
      ).toBe('ERASING');
      expect((await h.prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).isActive).toBe(
        false,
      );
      storage.removeRequired = async () => {};
      await api()
        .post('/api/v1/admin/operations/erasure/' + f.id)
        .set('Cookie', f.admin)
        .send({ action: 'ERASE', note: 'Reprise après panne' })
        .expect(201);
      expect(
        (await h.prisma.erasureRequest.findUniqueOrThrow({ where: { id: f.id } })).status,
      ).toBe('COMPLETED');
    } finally {
      storage.removeRequired = original;
    }
  });
  it('ne supprime pas un propriétaire avec un bien, consigne le motif et le rend au titulaire', async () => {
    const owner = await createUser(h.prisma, 'OWNER');
    const agent = await createUser(h.prisma, 'AGENT');
    await createProperty(h.prisma, owner.id);
    const ownerCookie = await login(owner.email),
      admin = await login(agent.email);
    const r = await api()
      .post('/api/v1/privacy/erasure')
      .set('Cookie', ownerCookie)
      .send({ password: TEST_PASSWORD })
      .expect(201);
    await api()
      .post('/api/v1/admin/operations/erasure/' + r.body.id)
      .set('Cookie', admin)
      .send({ action: 'ERASE', note: 'Demande du titulaire' })
      .expect(409);
    await api()
      .post('/api/v1/admin/operations/erasure/' + r.body.id)
      .set('Cookie', admin)
      .send({ action: 'HOLD', note: 'Bien à clôturer et conservation à examiner.' })
      .expect(201);
    expect(
      (await api().get('/api/v1/privacy/erasure').set('Cookie', ownerCookie)).body.reviewNote,
    ).toContain('Bien à clôturer');
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).isActive).toBe(
      true,
    );
  });
  it('purge les données techniques échues sans toucher les sessions actives, les incidents ouverts ou le facteur actif', async () => {
    const user = await createUser(h.prisma, 'TENANT');
    const old = new Date(Date.now() - 100 * 86400_000),
      future = new Date(Date.now() + 86400_000);
    await h.prisma.session.createMany({
      data: [
        { userId: user.id, tokenHash: hashSecret('expired'), expiresAt: old },
        { userId: user.id, tokenHash: hashSecret('active'), expiresAt: future },
      ],
    });
    await h.prisma.authToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret('expired-token'),
        purpose: 'PASSWORD_RESET',
        expiresAt: old,
      },
    });
    await h.prisma.securityEvent.create({ data: { action: 'OLD', createdAt: old } });
    await h.prisma.operationalIncident.createMany({
      data: [
        {
          fingerprint: 'open',
          requestId: 'test',
          category: 'HTTP_500',
          route: 'GET /test',
          firstSeenAt: old,
          lastSeenAt: old,
        },
        {
          fingerprint: 'closed',
          requestId: 'test',
          category: 'HTTP_500',
          route: 'GET /test',
          firstSeenAt: old,
          lastSeenAt: old,
          acknowledgedAt: old,
        },
      ],
    });
    const result = await h.app.get(OperationsService).purgeTechnicalData();
    expect(result.sessions).toBe(1);
    expect(result.tokens).toBe(1);
    expect(result.events).toBe(1);
    expect(result.incidents).toBe(1);
    expect(await h.prisma.session.count()).toBe(1);
    expect(
      await h.prisma.operationalIncident.findUnique({ where: { fingerprint: 'open' } }),
    ).not.toBeNull();
  });
  it('protège les actions d’exploitation contre une origine étrangère', async () => {
    const f = await fixture();
    await api()
      .post('/api/v1/admin/operations/erasure/' + f.id)
      .set('Cookie', f.admin)
      .set('Origin', 'https://foreign.invalid')
      .send({ action: 'HOLD', note: 'Tentative externe' })
      .expect(403);
  });
});
