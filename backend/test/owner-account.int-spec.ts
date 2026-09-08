import request from 'supertest';
import { jest } from '@jest/globals';
import type { SpiedFunction } from 'jest-mock';
import { AuthTokenPurpose, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { TEST_PASSWORD, createProperty, createUser } from './fixtures';
import { MailService } from '../src/modules/mail/mail.service';
import { TEMPLATE } from '../src/modules/mail/mail.templates';

describe('Compte et portefeuille propriétaire', () => {
  let h: Harness;
  let send: SpiedFunction<MailService['send']>;
  const api = () => request(h.app.getHttpServer());
  beforeAll(async () => {
    h = await createHarness();
    send = jest.spyOn(h.app.get(MailService), 'send').mockResolvedValue(true);
  });
  afterAll(async () => {
    send?.mockRestore();
    await h?.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
    send.mockClear();
  });
  const login = async (email: string) =>
    sessionCookie(
      await api()
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200),
    );
  const requestChange = async (cookie: string, email: string) => {
    await api()
      .post('/api/v1/auth/email/change')
      .set('Cookie', cookie)
      .send({ email, currentPassword: TEST_PASSWORD })
      .expect(204);
    const call = send.mock.calls
      .filter(([message]) => message.template === TEMPLATE.emailChange)
      .at(-1)?.[0];
    const token = call?.message.text.match(/jeton=([a-zA-Z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    return token as string;
  };

  it('modifie les noms et le téléphone sans toucher aux autres comptes ni à l’adresse postale', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const other = await createUser(h.prisma, UserRole.OWNER);
    const cookie = await login(owner.email);
    const result = await api()
      .patch('/api/v1/owner/contact')
      .set('Cookie', cookie)
      .send({ firstName: ' Sylvie ', lastName: ' Martin ', phone: '+33 6 12 34 56 78' })
      .expect(200);
    expect(result.body).toMatchObject({
      firstName: 'Sylvie',
      lastName: 'Martin',
      phone: '+33612345678',
      email: owner.email,
    });
    expect(result.body).not.toHaveProperty('passwordHash');
    expect(
      (await api().get('/api/v1/auth/me').set('Cookie', cookie)).body.user.firstName,
    ).toBe('Sylvie');
    expect(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: other.id } })).firstName,
    ).toBe(other.firstName);
    expect(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).addressLine,
    ).toBeNull();
    await api()
      .patch('/api/v1/owner/contact')
      .set('Cookie', cookie)
      .send({ firstName: '', lastName: 'Martin', phone: 'texte' })
      .expect(400);
    await api()
      .patch('/api/v1/owner/contact')
      .set('Cookie', cookie)
      .send({ firstName: 'Sylvie', lastName: 'Martin', phone: '', userId: other.id })
      .expect(400);
    await api()
      .patch('/api/v1/owner/contact')
      .send({ firstName: 'X', lastName: 'Y', phone: '' })
      .expect(401);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    await api()
      .patch('/api/v1/owner/contact')
      .set('Cookie', await login(tenant.email))
      .send({ firstName: 'X', lastName: 'Y', phone: '' })
      .expect(403);
  });

  it('garde l’ancien e-mail jusqu’à confirmation puis ferme les sessions et invalide le lien', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const cookie = await login(owner.email);
    const token = await requestChange(cookie, ' Nouvelle@exemple.test ');
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email).toBe(
      owner.email,
    );
    const result = await api()
      .post('/api/v1/auth/email/change/confirm')
      .send({ token })
      .expect(200);
    expect(result.body.email).toBe('nouvelle@exemple.test');
    await api().post('/api/v1/auth/email/change/confirm').send({ token }).expect(400);
    await api().get('/api/v1/owner/profile').set('Cookie', cookie).expect(401);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(401);
    const authenticated = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nouvelle@exemple.test', password: TEST_PASSWORD })
      .expect(200);
    expect(authenticated.body.user.emailVerified).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ template: TEMPLATE.emailChanged, to: owner.email }),
    );
  });

  it('refuse un mauvais mot de passe et une adresse déjà utilisée', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const other = await createUser(h.prisma, UserRole.OWNER);
    const cookie = await login(owner.email);
    await api()
      .post('/api/v1/auth/email/change')
      .set('Cookie', cookie)
      .send({ email: 'new@exemple.test', currentPassword: 'incorrect' })
      .expect(401);
    await api()
      .post('/api/v1/auth/email/change')
      .set('Cookie', cookie)
      .send({ email: other.email, currentPassword: TEST_PASSWORD })
      .expect(409);
    await api()
      .post('/api/v1/auth/email/change')
      .set('Cookie', cookie)
      .send({ email: 'invalide', currentPassword: TEST_PASSWORD })
      .expect(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('remplace les anciens liens et refuse un lien expiré', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const cookie = await login(owner.email);
    const first = await requestChange(cookie, 'first@exemple.test');
    const second = await requestChange(cookie, 'second@exemple.test');
    await api().post('/api/v1/auth/email/change/confirm').send({ token: first }).expect(400);
    await h.prisma.authToken.updateMany({
      where: { userId: owner.id, purpose: AuthTokenPurpose.EMAIL_CHANGE },
      data: { expiresAt: new Date(0) },
    });
    await api().post('/api/v1/auth/email/change/confirm').send({ token: second }).expect(400);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email).toBe(
      owner.email,
    );
  });

  it('ne valide un lien qu’une fois même avec deux confirmations simultanées', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const token = await requestChange(await login(owner.email), 'once@exemple.test');
    const results = await Promise.all([
      api().post('/api/v1/auth/email/change/confirm').send({ token }),
      api().post('/api/v1/auth/email/change/confirm').send({ token }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
  });

  it('garde le compte intact si l’adresse devient indisponible avant confirmation', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const token = await requestChange(await login(owner.email), 'taken@exemple.test');
    await createUser(h.prisma, UserRole.OWNER, { email: 'taken@exemple.test' });
    await api().post('/api/v1/auth/email/change/confirm').send({ token }).expect(409);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email).toBe(
      owner.email,
    );
  });

  it('signale un échec d’envoi et annule le lien sans changer l’adresse', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    send.mockResolvedValueOnce(false);
    await api()
      .post('/api/v1/auth/email/change')
      .set('Cookie', await login(owner.email))
      .send({ email: 'failed@exemple.test', currentPassword: TEST_PASSWORD })
      .expect(503);
    expect(
      await h.prisma.authToken.count({
        where: { userId: owner.id, purpose: AuthTokenPurpose.EMAIL_CHANGE, consumedAt: null },
      }),
    ).toBe(0);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email).toBe(
      owner.email,
    );
  });

  it('renvoie la première photo et l’adresse pour identifier le bien dans les deux vues', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    await h.prisma.propertyPhoto.createMany({
      data: [
        { propertyId: property.id, position: 1, storageKey: 'properties/second.jpg' },
        { propertyId: property.id, position: 0, storageKey: 'properties/first.jpg' },
      ],
    });
    const cookie = await login(owner.email);
    const properties = await api()
      .get('/api/v1/owner/properties')
      .set('Cookie', cookie)
      .expect(200);
    expect(properties.body[0]).toMatchObject({
      photoCount: 2,
      photoUrl: expect.stringContaining('first.jpg'),
    });
    const applications = await api()
      .get('/api/v1/owner/applications')
      .set('Cookie', cookie)
      .expect(200);
    expect(applications.body.tiles[0]).toMatchObject({
      reference: property.reference,
      addressLine: property.addressLine,
      photoUrl: properties.body[0].photoUrl,
    });
  });
});
