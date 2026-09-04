import request from 'supertest';
import { PropertyStatus, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { TEST_PASSWORD, createProperty, createUser } from './fixtures';

/**
 * Biens sauvegardés.
 *
 * Deux propriétés comptent plus que les autres, et ce sont des décisions de
 * conception, pas des détails : le compteur ne doit **jamais** sortir vers un
 * autre locataire — sur un marché à 6,8 candidatures par bien, un compteur
 * public découragerait des candidats et concentrerait tout le monde sur les
 * mêmes annonces — et la liste ne doit jamais dire au propriétaire **qui** a
 * sauvegardé, seulement combien.
 */
describe('Biens sauvegardés', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());

  const loginAs = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return sessionCookie(response);
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

  describe('sauvegarder', () => {
    it('part d’une liste vide', async () => {
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const response = await api()
        .get('/api/v1/tenant/saved')
        .set('Cookie', await loginAs(tenant.email))
        .expect(200);
      expect(response.body).toEqual([]);
    });

    it('ajoute, puis retire', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const cookie = await loginAs(tenant.email);

      await api()
        .put(`/api/v1/tenant/saved/${property.reference}`)
        .set('Cookie', cookie)
        .expect(200, { saved: true });

      const apres = await api()
        .get('/api/v1/tenant/saved/references')
        .set('Cookie', cookie)
        .expect(200);
      expect(apres.body).toEqual([property.reference]);

      await api()
        .delete(`/api/v1/tenant/saved/${property.reference}`)
        .set('Cookie', cookie)
        .expect(200, { saved: false });

      const vide = await api()
        .get('/api/v1/tenant/saved/references')
        .set('Cookie', cookie)
        .expect(200);
      expect(vide.body).toEqual([]);
    });

    it('reste idempotent sous clics répétés et simultanés', async () => {
      // Un double clic, ou deux onglets ouverts sur la même fiche, ne doivent
      // produire ni erreur ni doublon : c'est la contrainte d'unicité qui le
      // garantit, pas la discipline de l'appelant.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const cookie = await loginAs(tenant.email);

      const reponses = await Promise.all(
        Array.from({ length: 5 }, () =>
          api().put(`/api/v1/tenant/saved/${property.reference}`).set('Cookie', cookie),
        ),
      );

      expect(reponses.every((r) => r.status === 200)).toBe(true);
      expect(await h.prisma.savedProperty.count()).toBe(1);

      // Retirer deux fois n'est pas davantage une erreur.
      await api()
        .delete(`/api/v1/tenant/saved/${property.reference}`)
        .set('Cookie', cookie)
        .expect(200);
      await api()
        .delete(`/api/v1/tenant/saved/${property.reference}`)
        .set('Cookie', cookie)
        .expect(200);
    });

    it('refuse une référence inconnue', async () => {
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await api()
        .put('/api/v1/tenant/saved/MZ-0000')
        .set('Cookie', await loginAs(tenant.email))
        .expect(404);
    });

    it('refuse un brouillon jamais publié', async () => {
      // Il n'a jamais été visible : répondre autre chose que 404 confirmerait
      // son existence à qui devine une référence.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const brouillon = await createProperty(h.prisma, owner.id, {
        status: PropertyStatus.DRAFT,
      });
      await h.prisma.property.update({
        where: { id: brouillon.id },
        data: { publishedAt: null },
      });
      const tenant = await createUser(h.prisma, UserRole.TENANT);

      await api()
        .put(`/api/v1/tenant/saved/${brouillon.reference}`)
        .set('Cookie', await loginAs(tenant.email))
        .expect(404);
    });
  });

  describe('liste', () => {
    it('garde un bien loué, en le signalant', async () => {
      // Le faire disparaître laisserait croire à un défaut, et priverait le
      // locataire de l'information qui compte : ce logement n'est plus à
      // prendre.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const cookie = await loginAs(tenant.email);

      await api()
        .put(`/api/v1/tenant/saved/${property.reference}`)
        .set('Cookie', cookie)
        .expect(200);

      await h.prisma.property.update({
        where: { id: property.id },
        data: { status: PropertyStatus.RENTED, rentedAt: new Date() },
      });

      const response = await api()
        .get('/api/v1/tenant/saved')
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        reference: property.reference,
        status: PropertyStatus.RENTED,
        available: false,
      });
    });

    it('classe du plus récemment sauvegardé au plus ancien', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const premier = await createProperty(h.prisma, owner.id);
      const second = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const cookie = await loginAs(tenant.email);

      await api().put(`/api/v1/tenant/saved/${premier.reference}`).set('Cookie', cookie);
      await api().put(`/api/v1/tenant/saved/${second.reference}`).set('Cookie', cookie);

      const response = await api().get('/api/v1/tenant/saved').set('Cookie', cookie);
      expect(response.body.map((x: { reference: string }) => x.reference)).toEqual([
        second.reference,
        premier.reference,
      ]);
    });
  });

  describe('cloisonnement', () => {
    it('ne montre à un locataire que ses propres sauvegardes', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const [premier, second] = await Promise.all([
        createUser(h.prisma, UserRole.TENANT),
        createUser(h.prisma, UserRole.TENANT),
      ]);

      await api()
        .put(`/api/v1/tenant/saved/${property.reference}`)
        .set('Cookie', await loginAs(premier.email))
        .expect(200);

      const autre = await api()
        .get('/api/v1/tenant/saved')
        .set('Cookie', await loginAs(second.email))
        .expect(200);
      expect(autre.body).toEqual([]);
    });

    it('ferme les routes au propriétaire, à l’agent et à l’anonyme', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const agent = await createUser(h.prisma, UserRole.AGENT);

      await api()
        .get('/api/v1/tenant/saved')
        .set('Cookie', await loginAs(owner.email))
        .expect(403);
      await api()
        .get('/api/v1/tenant/saved')
        .set('Cookie', await loginAs(agent.email))
        .expect(403);
      await api().get('/api/v1/tenant/saved').expect(401);
      await api().put('/api/v1/tenant/saved/MZ-0001').expect(401);
    });

    it('n’expose jamais le décompte sur la fiche publique', async () => {
      // Un compteur public découragerait des candidats sur un marché déjà
      // tendu, et concentrerait les candidatures sur les mêmes annonces.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);

      await api()
        .put(`/api/v1/tenant/saved/${property.reference}`)
        .set('Cookie', await loginAs(tenant.email))
        .expect(200);

      const fiche = await api()
        .get(`/api/v1/properties/${property.reference}`)
        .expect(200);
      expect(JSON.stringify(fiche.body).toLowerCase()).not.toContain('saved');
    });
  });

  describe('décompte pour le propriétaire', () => {
    it('agrège sans jamais nommer personne', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);

      for (let i = 0; i < 3; i += 1) {
        const tenant = await createUser(h.prisma, UserRole.TENANT);
        await api()
          .put(`/api/v1/tenant/saved/${property.reference}`)
          .set('Cookie', await loginAs(tenant.email))
          .expect(200);
      }

      const biens = await api()
        .get('/api/v1/owner/properties')
        .set('Cookie', await loginAs(owner.email))
        .expect(200);

      const ligne = biens.body.find(
        (p: { reference: string }) => p.reference === property.reference,
      );
      expect(ligne.savedCount).toBe(3);
      // Aucune identité ne doit transiter : le propriétaire voit le résultat,
      // jamais les personnes — comme pour les pièces d'un dossier.
      const charge = JSON.stringify(biens.body);
      expect(charge).not.toContain('@bail.test');
      expect(charge.toLowerCase()).not.toContain('tenantid');
    });

    it('ne compte pas les sauvegardes des biens d’un autre propriétaire', async () => {
      const [premier, second] = await Promise.all([
        createUser(h.prisma, UserRole.OWNER),
        createUser(h.prisma, UserRole.OWNER),
      ]);
      const bienDuPremier = await createProperty(h.prisma, premier.id);
      await createProperty(h.prisma, second.id);

      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await api()
        .put(`/api/v1/tenant/saved/${bienDuPremier.reference}`)
        .set('Cookie', await loginAs(tenant.email))
        .expect(200);

      const biens = await api()
        .get('/api/v1/owner/properties')
        .set('Cookie', await loginAs(second.email))
        .expect(200);
      expect(biens.body.every((p: { savedCount: number }) => p.savedCount === 0)).toBe(
        true,
      );
    });
  });
});
