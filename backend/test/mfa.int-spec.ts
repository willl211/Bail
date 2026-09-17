import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createUser, TEST_PASSWORD } from './fixtures';
import { totp } from '../src/modules/auth/mfa.crypto';
import { hashSecret } from '../src/modules/auth/tokens';

describe('Double authentification admin', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());
  const login = (email: string, password = TEST_PASSWORD) =>
    api().post('/api/v1/auth/login').send({ email, password });
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
    h.app.get(ConfigService).set('auth.adminMfaRequired', true);
    h.app.get(ConfigService).set('auth.mfaEncryptionKey', 'ab'.repeat(32));
  });
  async function enroll() {
    const user = await createUser(h.prisma, 'AGENT');
    const passwordLogin = await login(user.email).expect(200);
    expect(passwordLogin.body.user.mfaRequired).toBe(true);
    const cookie = sessionCookie(passwordLogin);
    const setup = await api()
      .post('/api/v1/auth/mfa/setup')
      .set('Cookie', cookie)
      .send({ password: TEST_PASSWORD })
      .expect(201);
    const code = totp(setup.body.secret, Math.floor(Date.now() / 30000));
    const verified = await api()
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', cookie)
      .send({ code })
      .expect(200);
    return {
      user,
      cookie,
      code,
      secret: setup.body.secret as string,
      verified,
      authenticated: sessionCookie(verified),
    };
  }
  it('bloque les accès admin après le seul mot de passe, y compris les routes publiques de simulation', async () => {
    const user = await createUser(h.prisma, 'AGENT');
    const cookie = sessionCookie(await login(user.email).expect(200));
    for (const path of ['/admin/summary', '/admin/operations', '/admin/tenant-files']) {
      const blocked = await api()
        .get('/api/v1' + path)
        .set('Cookie', cookie)
        .expect(403);
      expect(blocked.body.code).toBe('MFA_REQUIRED');
    }
    await api().post('/api/v1/payments/webhook').set('Cookie', cookie).send({}).expect(403);
    expect((await api().get('/api/v1/auth/me').set('Cookie', cookie)).body.user.mfaRequired).toBe(
      true,
    );
    await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
  });
  it('enrôle, chiffre le secret, affiche les secours une fois et renouvelle la session', async () => {
    const f = await enroll();
    expect(f.verified.body.recoveryCodes).toHaveLength(10);
    expect(new Set(f.verified.body.recoveryCodes).size).toBe(10);
    expect(f.authenticated).not.toBe(f.cookie);
    await api().get('/api/v1/admin/operations').set('Cookie', f.authenticated).expect(200);
    await api().get('/api/v1/admin/operations').set('Cookie', f.cookie).expect(401);
    const credential = await h.prisma.mfaCredential.findUniqueOrThrow({
      where: { userId: f.user.id },
    });
    expect(credential.secretEncrypted).not.toContain(f.secret);
    expect(credential.recoveryHashes).not.toContain(f.verified.body.recoveryCodes[0]);
    const profile = await api().get('/api/v1/auth/me').set('Cookie', f.authenticated).expect(200);
    expect(JSON.stringify(profile.body)).not.toContain(f.secret);
    expect(profile.body.user.mfaRequired).toBe(false);
  });
  it('rejette le même code TOTP sur une nouvelle session', async () => {
    const f = await enroll();
    const cookie = sessionCookie(await login(f.user.email).expect(200));
    await api()
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', cookie)
      .send({ code: f.code })
      .expect(401);
    await api().get('/api/v1/admin/operations').set('Cookie', cookie).expect(403);
  });
  it('consomme un code de secours une seule fois sous concurrence', async () => {
    const f = await enroll();
    const cookies = await Promise.all([login(f.user.email), login(f.user.email)]).then(
      (responses) => responses.map(sessionCookie),
    );
    const code = f.verified.body.recoveryCodes[0];
    const responses = await Promise.all(
      cookies.map((cookie) =>
        api().post('/api/v1/auth/mfa/verify').set('Cookie', cookie).send({ code }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(
      (await h.prisma.mfaCredential.findUniqueOrThrow({ where: { userId: f.user.id } }))
        .recoveryHashes,
    ).not.toContain(hashSecret(code));
  });
  it('limite les tentatives MFA par compte même avec plusieurs sessions', async () => {
    const f = await enroll();
    await h.prisma.authRateLimit.deleteMany();
    const cookie = sessionCookie(await login(f.user.email).expect(200));
    for (let i = 0; i < 8; i++)
      await api()
        .post('/api/v1/auth/mfa/verify')
        .set('Cookie', cookie)
        .send({ code: 'incorrect' })
        .expect(401);
    await api()
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', cookie)
      .send({ code: f.verified.body.recoveryCodes[0] })
      .expect(429);
  });
  it('ne permet pas de remplacer un facteur déjà activé avec le seul mot de passe', async () => {
    const f = await enroll();
    const cookie = sessionCookie(await login(f.user.email).expect(200));
    await api()
      .post('/api/v1/auth/mfa/setup')
      .set('Cookie', cookie)
      .send({ password: TEST_PASSWORD })
      .expect(409);
  });
  it('rejette les autres rôles et une configuration expirée', async () => {
    const tenant = await createUser(h.prisma, 'TENANT');
    await api()
      .post('/api/v1/auth/mfa/setup')
      .set('Cookie', sessionCookie(await login(tenant.email)))
      .send({ password: TEST_PASSWORD })
      .expect(403);
    const agent = await createUser(h.prisma, 'AGENT');
    const cookie = sessionCookie(await login(agent.email));
    const setup = await api()
      .post('/api/v1/auth/mfa/setup')
      .set('Cookie', cookie)
      .send({ password: TEST_PASSWORD })
      .expect(201);
    await h.prisma.mfaCredential.update({
      where: { userId: agent.id },
      data: { setupExpiresAt: new Date(0) },
    });
    await api()
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', cookie)
      .send({ code: totp(setup.body.secret, Math.floor(Date.now() / 30000)) })
      .expect(400);
  });
  it('le changement de mot de passe ne retire pas le facteur et invalide les sessions', async () => {
    const f = await enroll();
    const password = 'NouveauMotDePasseSecurise2026!';
    await api()
      .post('/api/v1/auth/password/change')
      .set('Cookie', f.authenticated)
      .send({ currentPassword: TEST_PASSWORD, password })
      .expect(204);
    await api().get('/api/v1/admin/operations').set('Cookie', f.authenticated).expect(401);
    const response = await login(f.user.email, password).expect(200);
    expect(response.body.user.mfaRequired).toBe(true);
    expect(response.body.user.mfaEnrolled).toBe(true);
  });
  it('expire les sessions qui attendent un facteur depuis plus de dix minutes', async () => {
    const user = await createUser(h.prisma, 'AGENT');
    const cookie = sessionCookie(await login(user.email));
    await h.prisma.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 11 * 60000) },
    });
    await api()
      .post('/api/v1/auth/mfa/setup')
      .set('Cookie', cookie)
      .send({ password: TEST_PASSWORD })
      .expect(401);
  });
});
