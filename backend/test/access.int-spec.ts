import request from 'supertest';
import { PropertyStatus, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { TEST_PASSWORD, createProperty, createUser, createVerifiedFile } from './fixtures';

/**
 * Qui a le droit de voir quoi.
 *
 * Deux règles y sont vérifiées, qui sont des choix de conception et non des
 * détails d'implémentation. Le bien d'autrui renvoie **404 et non 403** :
 * répondre « interdit » confirmerait que la référence existe, et permettrait de
 * balayer le portefeuille d'un concurrent une référence après l'autre. Et toute
 * route est privée par défaut : elle doit être explicitement ouverte, de sorte
 * qu'un oubli la rende inaccessible — visible immédiatement — plutôt que
 * exposée sans contrôle.
 */
describe('Portée des accès', () => {
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

  describe('bien d’un autre propriétaire', () => {
    it('répond 404, pas 403', async () => {
      const [premier, second] = await Promise.all([
        createUser(h.prisma, UserRole.OWNER),
        createUser(h.prisma, UserRole.OWNER),
      ]);
      const property = await createProperty(h.prisma, premier.id);
      const cookie = await loginAs(second.email);

      await api()
        .get(`/api/v1/owner/properties/${property.reference}`)
        .set('Cookie', cookie)
        .expect(404);
    });

    it('donne la même réponse pour une référence inexistante', async () => {
      // Les deux cas doivent être indiscernables, sans quoi la distinction
      // suffit à savoir qu'une référence existe.
      //
      // Le message reprend la référence demandée — une donnée que l'appelant
      // vient de fournir, qui ne lui apprend donc rien. C'est le reste qui doit
      // être identique au caractère près, d'où la normalisation.
      const [premier, second] = await Promise.all([
        createUser(h.prisma, UserRole.OWNER),
        createUser(h.prisma, UserRole.OWNER),
      ]);
      const property = await createProperty(h.prisma, premier.id);
      const cookie = await loginAs(second.email);

      const autrui = await api()
        .get(`/api/v1/owner/properties/${property.reference}`)
        .set('Cookie', cookie)
        .expect(404);
      const inexistant = await api()
        .get('/api/v1/owner/properties/MZ-0000')
        .set('Cookie', cookie)
        .expect(404);

      const gabarit = (message: string, reference: string) =>
        message.replaceAll(reference, '<référence>');

      expect(gabarit(autrui.body.message, property.reference)).toBe(
        gabarit(inexistant.body.message, 'MZ-0000'),
      );
      expect(autrui.body.statusCode).toBe(inexistant.body.statusCode);
    });

    it('refuse aussi la modification', async () => {
      const [premier, second] = await Promise.all([
        createUser(h.prisma, UserRole.OWNER),
        createUser(h.prisma, UserRole.OWNER),
      ]);
      const property = await createProperty(h.prisma, premier.id, {
        status: PropertyStatus.DRAFT,
      });
      const cookie = await loginAs(second.email);

      await api()
        .patch(`/api/v1/owner/properties/${property.reference}`)
        .set('Cookie', cookie)
        .send({ title: 'Titre détourné' })
        .expect(404);

      const inchange = await h.prisma.property.findUniqueOrThrow({
        where: { id: property.id },
      });
      expect(inchange.title).toBe(property.title);
    });
  });

  describe('cloisonnement des rôles', () => {
    it('ferme le back-office au propriétaire et au locataire', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const tenant = await createUser(h.prisma, UserRole.TENANT);

      await api()
        .get('/api/v1/admin/summary')
        .set('Cookie', await loginAs(owner.email))
        .expect(403);
      await api()
        .get('/api/v1/admin/summary')
        .set('Cookie', await loginAs(tenant.email))
        .expect(403);
    });

    it('ouvre le back-office à l’agent', async () => {
      const agent = await createUser(h.prisma, UserRole.AGENT);
      await api()
        .get('/api/v1/admin/summary')
        .set('Cookie', await loginAs(agent.email))
        .expect(200);
    });

    it('ferme l’espace propriétaire au locataire', async () => {
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await api()
        .get('/api/v1/owner/properties')
        .set('Cookie', await loginAs(tenant.email))
        .expect(403);
    });

    it('répond 401 à l’anonyme, pas 403', async () => {
      // « Non authentifié » et « non autorisé » sont deux situations
      // différentes : le front n'a pas le même écran à proposer.
      await api().get('/api/v1/admin/summary').expect(401);
      await api().get('/api/v1/owner/properties').expect(401);
      await api().get('/api/v1/tenant/file').expect(401);
    });

    it('laisse la recherche ouverte sans compte', async () => {
      // La recherche et la fiche annonce sont consultables sans compte : c'est
      // l'écran 1 du parcours.
      await api().get('/api/v1/properties').expect(200);
    });
  });

  describe('pièces d’un dossier locataire', () => {
    it('n’expose jamais un document à un autre compte', async () => {
      // La promesse faite au locataire : le propriétaire voit le résultat des
      // contrôles, jamais les documents.
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const file = await createVerifiedFile(h.prisma, tenant.id);
      const document = await h.prisma.tenantDocument.findFirstOrThrow({
        where: { tenantFileId: file.id },
      });

      const owner = await createUser(h.prisma, UserRole.OWNER);
      await api()
        .get(`/api/v1/tenant/file/documents/${document.id}/file`)
        .set('Cookie', await loginAs(owner.email))
        .expect((response) => {
          expect([403, 404]).toContain(response.status);
        });
    });
  });

  describe('adresse confirmée', () => {
    it('bloque la candidature tant qu’elle ne l’est pas', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT, { emailVerified: false });
      await createVerifiedFile(h.prisma, tenant.id);
      const cookie = await loginAs(tenant.email);

      const preview = await api()
        .get(`/api/v1/tenant/applications/${property.reference}/preview`)
        .set('Cookie', cookie)
        .expect(200);
      expect(preview.body.blockers.join(' ')).toMatch(/adresse e-mail/i);

      // Le blocage est aussi opposé à l'envoi : l'aperçu n'est pas un contrôle
      // d'accès, c'est un affichage.
      await api()
        .post(`/api/v1/tenant/applications/${property.reference}`)
        .set('Cookie', cookie)
        .send({})
        .expect(400);

      expect(await h.prisma.application.count()).toBe(0);
    });

    it('laisse passer une fois l’adresse confirmée', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);

      await api()
        .post(`/api/v1/tenant/applications/${property.reference}`)
        .set('Cookie', await loginAs(tenant.email))
        .send({})
        .expect(201);
    });

    it('bloque la soumission d’une annonce au contrôle', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER, { emailVerified: false });
      const property = await createProperty(h.prisma, owner.id, {
        status: PropertyStatus.DRAFT,
      });

      const response = await api()
        .post(`/api/v1/owner/properties/${property.reference}/submit`)
        .set('Cookie', await loginAs(owner.email))
        .expect(400);

      expect(response.body.blockers.join(' ')).toMatch(/adresse e-mail/i);
      const inchange = await h.prisma.property.findUniqueOrThrow({
        where: { id: property.id },
      });
      expect(inchange.status).toBe(PropertyStatus.DRAFT);
    });
  });

  describe('compte désactivé', () => {
    it('ne peut plus se connecter', async () => {
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await h.prisma.user.update({
        where: { id: tenant.id },
        data: { isActive: false },
      });

      await api()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('voit sa session en cours cesser de valoir', async () => {
      // Une session se révoque en base, immédiatement : c'est ce qui a fait
      // écarter le JWT (docs/tech-stack.md).
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const cookie = await loginAs(tenant.email);

      await h.prisma.user.update({
        where: { id: tenant.id },
        data: { isActive: false },
      });

      const me = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body.user).toBeNull();
    });
  });
});
