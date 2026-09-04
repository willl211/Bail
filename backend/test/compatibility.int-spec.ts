import request from 'supertest';
import { EmploymentContractType, GuarantorRequirement, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { TEST_PASSWORD, createProperty, createUser, createVerifiedFile } from './fixtures';

/**
 * Classement des annonces par compatibilité.
 *
 * Le panneau de filtres promet que « les biens compatibles avec vos revenus
 * remontent en tête ». Cette suite tient cette promesse-là, et la façon dont
 * elle se tait quand elle ne peut pas être tenue : sans dossier renseignant
 * les revenus, le classement retombe sur la récence **et le dit**, plutôt que
 * de rendre un ordre quelconque sous une étiquette flatteuse.
 */
describe('Classement par compatibilité', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());

  const loginAs = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return sessionCookie(response);
  };

  /** Références servies, dans l'ordre rendu. */
  const search = async (cookie?: string) => {
    const call = api().get('/api/v1/properties?pageSize=20');
    const response = await (cookie ? call.set('Cookie', cookie) : call).expect(200);
    return {
      sort: response.body.sort as string,
      references: (response.body.items as { reference: string }[]).map((p) => p.reference),
    };
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

  describe('sans dossier exploitable', () => {
    it('sert la récence à l’anonyme, et l’annonce', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      await createProperty(h.prisma, owner.id);

      expect((await search()).sort).toBe('recent');
    });

    it('sert la récence au locataire dont le dossier ignore les revenus', async () => {
      // Les trois autres parts du barème valent autant partout : sans revenus,
      // le classement laisserait tout le portefeuille ex æquo.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await h.prisma.tenantFile.create({
        data: { tenantId: tenant.id, reference: 'LOC-2026-9001' },
      });

      expect((await search(await loginAs(tenant.email))).sort).toBe('recent');
    });

    it('ne crée pas de dossier à celui qui ne fait que chercher', async () => {
      // Le classement lit le dossier à chaque recherche. S'il l'ouvrait au
      // passage, chercher une fois suffirait à faire exister un dossier vide —
      // un effet de bord invisible sur une route de lecture.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);

      await search(await loginAs(tenant.email));

      expect(await h.prisma.tenantFile.count({ where: { tenantId: tenant.id } })).toBe(0);
    });

    it('ne classe pas un propriétaire sur le dossier de quelqu’un d’autre', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      await createProperty(h.prisma, owner.id);

      expect((await search(await loginAs(owner.email))).sort).toBe('recent');
    });
  });

  describe('avec un dossier qui dit les revenus', () => {
    it('remonte le plus abordable, et l’annonce', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const cher = await createProperty(h.prisma, owner.id);
      const abordable = await createProperty(h.prisma, owner.id);
      await h.prisma.property.update({
        where: { id: cher.id },
        data: { rentCents: 120_000, chargesCents: 10_000 },
      });
      await h.prisma.property.update({
        where: { id: abordable.id },
        data: { rentCents: 45_000, chargesCents: 4_000 },
      });

      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);

      const { sort, references } = await search(await loginAs(tenant.email));
      expect(sort).toBe('compatibility');
      expect(references[0]).toBe(abordable.reference);
    });

    it('fait passer un bien plus cher devant un bien qui exclut le contrat', async () => {
      // C'est tout l'écart avec « loyer croissant » : le moins cher ne sert à
      // rien s'il refuse le contrat de celui qui cherche.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const ferme = await createProperty(h.prisma, owner.id);
      const ouvert = await createProperty(h.prisma, owner.id);
      await h.prisma.property.update({
        where: { id: ferme.id },
        data: {
          rentCents: 45_000,
          chargesCents: 4_000,
          acceptedContractTypes: [EmploymentContractType.PUBLIC_SECTOR],
        },
      });
      await h.prisma.property.update({
        where: { id: ouvert.id },
        data: { rentCents: 60_000, chargesCents: 5_000, acceptedContractTypes: [] },
      });

      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id); // CDI

      const { references } = await search(await loginAs(tenant.email));
      expect(references.indexOf(ouvert.reference)).toBeLessThan(
        references.indexOf(ferme.reference),
      );
    });

    it('remonte le bien sans garant exigé pour un dossier sans garant', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const avecExigence = await createProperty(h.prisma, owner.id);
      const sansExigence = await createProperty(h.prisma, owner.id);
      await h.prisma.property.update({
        where: { id: avecExigence.id },
        data: {
          rentCents: 50_000,
          chargesCents: 4_000,
          guarantorRequirement: GuarantorRequirement.REQUIRED,
        },
      });
      await h.prisma.property.update({
        where: { id: sansExigence.id },
        data: {
          rentCents: 52_000,
          chargesCents: 4_000,
          guarantorRequirement: GuarantorRequirement.NONE,
        },
      });

      // `createVerifiedFile` ne déclare aucun garant : c'est bien ce cas-là.
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);

      const { references } = await search(await loginAs(tenant.email));
      expect(references.indexOf(sansExigence.reference)).toBeLessThan(
        references.indexOf(avecExigence.reference),
      );
    });

    it('classe l’ensemble, pas seulement la page servie', async () => {
      // Trier page par page ne trierait rien : le bien le plus compatible doit
      // remonter en première page même s'il était le dernier par récence.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const biens = [];
      for (let i = 0; i < 5; i += 1) {
        biens.push(await createProperty(h.prisma, owner.id));
      }
      // Le premier publié — donc le dernier par récence — est le moins cher.
      await h.prisma.property.update({
        where: { id: biens[0].id },
        data: { rentCents: 30_000, chargesCents: 2_000 },
      });

      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);
      const cookie = await loginAs(tenant.email);

      const response = await api()
        .get('/api/v1/properties?pageSize=2')
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body.items[0].reference).toBe(biens[0].reference);
      expect(response.body.total).toBe(5);
      expect(response.body.items).toHaveLength(2);
    });

    it('laisse un tri explicite l’emporter', async () => {
      // Choisir « loyer décroissant » doit être obéi : la compatibilité est un
      // défaut, pas une préférence imposée.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const cher = await createProperty(h.prisma, owner.id);
      const abordable = await createProperty(h.prisma, owner.id);
      await h.prisma.property.update({
        where: { id: cher.id },
        data: { rentCents: 120_000 },
      });
      await h.prisma.property.update({
        where: { id: abordable.id },
        data: { rentCents: 40_000 },
      });

      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);

      const response = await api()
        .get('/api/v1/properties?sort=rent_desc')
        .set('Cookie', await loginAs(tenant.email))
        .expect(200);

      expect(response.body.sort).toBe('rent_desc');
      expect(response.body.items[0].reference).toBe(cher.reference);
    });
  });

  describe('biens en avant', () => {
    it('met en avant les plus compatibles pour un locataire', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const biens = [];
      for (let i = 0; i < 4; i += 1) {
        biens.push(await createProperty(h.prisma, owner.id));
      }
      // Le plus ancien est aussi le plus abordable : la récence seule ne le
      // mettrait jamais en avant.
      await h.prisma.property.update({
        where: { id: biens[0].id },
        data: { rentCents: 35_000, chargesCents: 2_000 },
      });

      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);

      const anonyme = await api().get('/api/v1/properties/featured?limit=2').expect(200);
      expect(anonyme.body.map((p: { reference: string }) => p.reference)).not.toContain(
        biens[0].reference,
      );

      const connecte = await api()
        .get('/api/v1/properties/featured?limit=2')
        .set('Cookie', await loginAs(tenant.email))
        .expect(200);
      expect(connecte.body[0].reference).toBe(biens[0].reference);
      expect(connecte.body).toHaveLength(2);
    });
  });
});
