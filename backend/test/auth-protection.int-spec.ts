import { jest } from '@jest/globals';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthRateLimitService } from '../src/modules/auth/auth-rate-limit.service';
import { authNetwork } from '../src/modules/auth/auth-protection.guard';
import { hashSecret } from '../src/modules/auth/tokens';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';

describe('Protection des connexions', () => {
  let h: Harness;
  const password = 'MotDePasseDeTest2026';
  const email = 'awa@bail.test';
  const api = () => request(h.app.getHttpServer());
  const login = (address = email, secret = 'incorrect') =>
    api().post('/api/v1/auth/login').send({ email: address, password: secret });
  const bucketKey = (scope: string, subject: string) =>
    hashSecret(JSON.stringify([scope, subject]));

  async function seedUser(role: UserRole = UserRole.TENANT) {
    return h.prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        firstName: 'Awa',
        lastName: 'Diallo',
        role,
      },
    });
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
  afterEach(() => {
    jest.restoreAllMocks();
    h.app.getHttpAdapter().getInstance().set('trust proxy', false);
  });

  it('bloque avant la vérification du mot de passe et ne crée aucune session', async () => {
    await seedUser();
    for (let i = 0; i < 10; i++) await login().expect(401);
    const verify = jest.spyOn(h.app.get(AuthService), 'login');
    const blocked = await login(email, password).expect(429);
    expect(verify).not.toHaveBeenCalled();
    expect(blocked.body.code).toBe('AUTH_RATE_LIMITED');
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(blocked.headers['retry-after']).toBe(String(blocked.body.retryAfterSeconds));
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(blocked.body.message).toContain('Réessayez dans');
    expect(await h.prisma.session.count()).toBe(0);
  });

  it('applique aussi la limite au compte administrateur', async () => {
    await seedUser(UserRole.AGENT);
    for (let i = 0; i < 10; i++) await login().expect(401);
    await login(email, password).expect(429);
  });

  it('normalise la casse et les espaces avant de compter, même pour un compte inconnu', async () => {
    // Un corps invalide compte aussi : la validation ne doit pas ouvrir un contournement.
    for (let i = 0; i < 10; i++) {
      await api().post('/api/v1/auth/login').send({ email: ' INCONNU@BAIL.TEST ' }).expect(400);
    }
    const blocked = await login('inconnu@bail.test').expect(429);
    expect(blocked.body.code).toBe('AUTH_RATE_LIMITED');
  });

  it('limite un même compte malgré plusieurs IP transmises par un proxy de confiance', async () => {
    h.app.getHttpAdapter().getInstance().set('trust proxy', ['loopback']);
    await seedUser();
    for (let i = 0; i < 10; i++) {
      await login()
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .expect(401);
    }
    await login(email, password).set('X-Forwarded-For', '203.0.113.1').expect(429);
  });

  it('ignore une IP forgée en accès direct et limite les rafales sur plusieurs comptes', async () => {
    for (let i = 0; i < 20; i++) {
      await api()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ email: `inconnu${i}@bail.test` })
        .expect(400);
    }
    await login('autre@bail.test').set('X-Forwarded-For', '203.0.113.3').expect(429);
  });

  it('garde la limite IP longue après expiration de la limite de rafale', async () => {
    // Consomme les quotas via HTTP mais fait expirer la courte fenêtre entre les lots.
    for (let i = 0; i < 50; i++) {
      if (i && i % 15 === 0) {
        const key = bucketKey('auth:ip:burst', '127.0.0.1');
        await h.prisma
          .$executeRaw`UPDATE "auth_rate_limits" SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "key" = ${key}`;
      }
      await api()
        .post('/api/v1/auth/login')
        .send({ email: `inconnu${i}@bail.test` })
        .expect(400);
    }
    await login('nouveau@bail.test').expect(429);
  });

  it('laisse les autres comptes se connecter quand seul un compte est limité', async () => {
    await seedUser();
    for (let i = 0; i < 10; i++) {
      await api().post('/api/v1/auth/login').send({ email: 'autre@bail.test' }).expect(400);
    }
    await login(email, password).expect(200);
  });

  it('ne prolonge pas le blocage et autorise de nouveau la connexion après expiration', async () => {
    await seedUser();
    for (let i = 0; i < 10; i++) await login().expect(401);
    const key = bucketKey('login:email', email);
    const read = () =>
      h.prisma.$queryRaw<
        { expiresAt: Date }[]
      >`SELECT "expiresAt" FROM "auth_rate_limits" WHERE "key" = ${key}`;
    const [before] = await read();
    await login(email, password).expect(429);
    const [after] = await read();
    expect(after.expiresAt).toEqual(before.expiresAt);
    await h.prisma
      .$executeRaw`UPDATE "auth_rate_limits" SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "key" = ${key}`;
    await login(email, password).expect(200);
  });

  it('réserve atomiquement les tentatives concurrentes et les conserve dans une nouvelle instance', async () => {
    const limiter = h.app.get(AuthRateLimitService);
    const quota = { scope: 'login:email', subject: email, limit: 7, windowSeconds: 900 };
    const results = await Promise.all(Array.from({ length: 25 }, () => limiter.consume(quota)));
    expect(results.filter((delay) => delay === 0)).toHaveLength(7);
    expect(results.filter((delay) => delay > 0)).toHaveLength(18);
    const restarted = new AuthRateLimitService(h.prisma);
    expect(await restarted.consume(quota)).toBeGreaterThan(0);
    const buckets = await h.prisma.$queryRaw<
      { key: string; attempts: number }[]
    >`SELECT "key", "attempts" FROM "auth_rate_limits"`;
    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(buckets)).not.toContain(email);
  });

  it('ne dépasse pas le quota quand plusieurs connexions arrivent ensemble', async () => {
    await seedUser();
    const responses = await Promise.all(Array.from({ length: 15 }, () => login()));
    expect(responses.filter((response) => response.status === 401)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
  });

  it('refuse de connecter si le stockage des quotas est indisponible', async () => {
    await seedUser();
    jest
      .spyOn(h.app.get(AuthRateLimitService), 'consume')
      .mockRejectedValue(new Error('Test stockage indisponible'));
    const verify = jest.spyOn(h.app.get(AuthService), 'login');
    await login(email, password).expect(503);
    expect(verify).not.toHaveBeenCalled();
    expect(await h.prisma.session.count()).toBe(0);
  });

  it('limite les inscriptions avant le hachage, y compris les corps invalides', async () => {
    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/register').send({}).expect(400);
    const register = jest.spyOn(h.app.get(AuthService), 'register');
    await api()
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Awa', lastName: 'Diallo', role: 'TENANT' })
      .expect(429);
    expect(register).not.toHaveBeenCalled();
    expect(await h.prisma.user.count()).toBe(0);
  });

  it('limite la récupération pour une adresse connue comme inconnue sans révéler son existence', async () => {
    await seedUser();
    for (const address of [email, 'inconnu@bail.test']) {
      for (let i = 0; i < 3; i++) {
        await api().post('/api/v1/auth/password/forgot').send({ email: address }).expect(204);
      }
      await api().post('/api/v1/auth/password/forgot').send({ email: address }).expect(429);
    }
  });

  it('partage le quota des vérifications du mot de passe actuel entre les changements sensibles', async () => {
    await seedUser();
    const cookie = sessionCookie(await login(email, password).expect(200));
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/api/v1/auth/password/change')
        .set('Cookie', cookie)
        .send({ currentPassword: 'faux', password: 'UnAutreMotDePasse2026' })
        .expect(401);
    }
    await api()
      .post('/api/v1/auth/email/change')
      .set('Cookie', cookie)
      .send({ currentPassword: password, email: 'autre@bail.test' })
      .expect(429);
  });

  it('refuse les connexions et déconnexions déclenchées depuis une origine étrangère', async () => {
    await seedUser();
    await login(email, password).set('Origin', 'https://intrus.test').expect(403);
    await login(email, password).set('Origin', 'null').expect(403);
    await login(email, password).set('Sec-Fetch-Site', 'cross-site').expect(403);
    expect(await h.prisma.session.count()).toBe(0);
    const cookie = sessionCookie(
      await login(email, password).set('Origin', 'http://localhost:3000').expect(200),
    );
    await api()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://intrus.test')
      .expect(403);
    const me = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user.email).toBe(email);
  });

  it('conserve les pages publiques et la déconnexion accessibles pendant un blocage', async () => {
    await seedUser();
    const cookie = sessionCookie(await login(email, password).expect(200));
    for (let i = 0; i < 9; i++) await login().expect(401);
    await login().expect(429);
    await api().get('/api/v1/districts').expect(200);
    await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    const me = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user).toBeNull();
  });

  it('renvoie la même erreur pour un compte désactivé et un mauvais mot de passe', async () => {
    const user = await seedUser();
    const wrong = await login().expect(401);
    await h.prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const disabled = await login(email, password).expect(401);
    expect(disabled.body.message).toBe(wrong.body.message);
  });

  it('ignore les cookies JSON malformés sans erreur serveur, y compris à la déconnexion', async () => {
    const cookie = 'bail_session=j%3A%7B%22unexpected%22%3Atrue%7D';
    const me = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user).toBeNull();
    await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
  });

  it('purge les anciens compteurs mais préserve les limites actives', async () => {
    const limiter = h.app.get(AuthRateLimitService);
    const quota = { scope: 'login:email', subject: email, limit: 1, windowSeconds: 900 };
    await limiter.consume(quota);
    await limiter.consume({ ...quota, subject: 'ancien@bail.test' });
    const key = bucketKey(quota.scope, 'ancien@bail.test');
    await h.prisma
      .$executeRaw`UPDATE "auth_rate_limits" SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE "key" = ${key}`;
    await limiter.purgeExpired();
    expect(await limiter.consume(quota)).toBeGreaterThan(0);
    const remaining = await h.prisma.$queryRaw<
      { key: string }[]
    >`SELECT "key" FROM "auth_rate_limits"`;
    expect(remaining).toHaveLength(1);
  });

  it('regroupe les variantes IPv6, les sous-réseaux et les adresses IPv4 mappées', () => {
    expect(authNetwork('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(authNetwork('0:0:0:0:0:ffff:7f00:1')).toBe('127.0.0.1');
    expect(authNetwork('2001:db8:abcd:1::2')).toBe(
      authNetwork('2001:0db8:abcd:0001:ffff:eeee:cccc:aaaa'),
    );
    expect(authNetwork('2001:db8:abcd:2::1')).not.toBe(authNetwork('2001:db8:abcd:1::1'));
    expect(authNetwork('fe80::1%eth0')).toBe(authNetwork('fe80::2'));
    expect(authNetwork('invalid')).toBe('unknown');
  });
});
