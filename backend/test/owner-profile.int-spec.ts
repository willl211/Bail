import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { TEST_PASSWORD, createUser } from './fixtures';

/**
 * Coordonnées postales du bailleur.
 *
 * Obligatoires au bail (loi n° 89-462 du 6 juillet 1989, article 3). Ces cas
 * vérifient les deux extrémités : que l'API refuse une adresse qui ne désigne
 * aucun domicile, et qu'elle n'expose jamais celle d'un autre compte.
 */
describe('Adresse du bailleur', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());

  const loginAs = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return sessionCookie(response);
  };

  const adresse = {
    addressLine: '9 rue Serpenoise',
    postalCode: '57000',
    city: 'Metz',
  };

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
  });

  it('part vide et se déclare incomplète', async () => {
    // Un compte se crée en trois champs : réclamer une adresse à l'inscription
    // allongerait l'étape la plus fragile du parcours.
    const owner = await createUser(h.prisma, UserRole.OWNER);

    const response = await api()
      .get('/api/v1/owner/profile')
      .set('Cookie', await loginAs(owner.email))
      .expect(200);

    expect(response.body).toEqual({
      addressLine: null,
      postalCode: null,
      city: null,
      complete: false,
    });
  });

  it('enregistre une adresse complète et la relit', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const cookie = await loginAs(owner.email);

    const enregistre = await api()
      .patch('/api/v1/owner/profile')
      .set('Cookie', cookie)
      .send(adresse)
      .expect(200);

    expect(enregistre.body).toEqual({ ...adresse, complete: true });

    const relu = await api()
      .get('/api/v1/owner/profile')
      .set('Cookie', cookie)
      .expect(200);
    expect(relu.body).toEqual({ ...adresse, complete: true });
  });

  it('retire les espaces autour des valeurs', async () => {
    // Sans quoi une adresse recopiée depuis un autre document porterait ses
    // espaces jusque sur l'acte.
    const owner = await createUser(h.prisma, UserRole.OWNER);

    const response = await api()
      .patch('/api/v1/owner/profile')
      .set('Cookie', await loginAs(owner.email))
      .send({ addressLine: '  9 rue Serpenoise  ', postalCode: ' 57000 ', city: ' Metz ' })
      .expect(200);

    expect(response.body).toMatchObject(adresse);
  });

  describe('validation', () => {
    it.each([
      ['un code postal à quatre chiffres', { postalCode: '5700' }],
      ['un code postal alphabétique', { postalCode: 'ABCDE' }],
      ['une voie réduite à un caractère', { addressLine: '9' }],
      ['une commune vide', { city: '   ' }],
    ])('refuse %s', async (_label, invalide) => {
      const owner = await createUser(h.prisma, UserRole.OWNER);

      await api()
        .patch('/api/v1/owner/profile')
        .set('Cookie', await loginAs(owner.email))
        .send({ ...adresse, ...invalide })
        .expect(400);
    });

    it('refuse une adresse partielle', async () => {
      // Les trois champs vont ensemble : accepter une voie sans commune
      // laisserait un domicile indésignable sur l'acte.
      const owner = await createUser(h.prisma, UserRole.OWNER);

      await api()
        .patch('/api/v1/owner/profile')
        .set('Cookie', await loginAs(owner.email))
        .send({ addressLine: '9 rue Serpenoise' })
        .expect(400);
    });

    it('ne laisse rien en base après un refus', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);

      await api()
        .patch('/api/v1/owner/profile')
        .set('Cookie', await loginAs(owner.email))
        .send({ ...adresse, postalCode: 'invalide' })
        .expect(400);

      const relu = await h.prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(relu.addressLine).toBeNull();
    });
  });

  describe('cloisonnement', () => {
    it('n’expose que l’adresse du compte connecté', async () => {
      const [premier, second] = await Promise.all([
        createUser(h.prisma, UserRole.OWNER),
        createUser(h.prisma, UserRole.OWNER),
      ]);
      await api()
        .patch('/api/v1/owner/profile')
        .set('Cookie', await loginAs(premier.email))
        .send(adresse)
        .expect(200);

      const autre = await api()
        .get('/api/v1/owner/profile')
        .set('Cookie', await loginAs(second.email))
        .expect(200);

      expect(autre.body.addressLine).toBeNull();
    });

    it('ferme la route au locataire et à l’anonyme', async () => {
      const tenant = await createUser(h.prisma, UserRole.TENANT);

      await api()
        .get('/api/v1/owner/profile')
        .set('Cookie', await loginAs(tenant.email))
        .expect(403);
      await api().get('/api/v1/owner/profile').expect(401);
      await api().patch('/api/v1/owner/profile').send(adresse).expect(401);
    });
  });
});
