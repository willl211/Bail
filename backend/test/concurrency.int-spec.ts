import request from 'supertest';
import { UserRole, VisitType } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { EVENT } from '../src/modules/mail/event.templates';
import { MailService } from '../src/modules/mail/mail.service';
import {
  TEST_PASSWORD,
  createProperty,
  createUser,
  createVerifiedFile,
} from './fixtures';

/**
 * Ce que seule une vraie base peut prouver.
 *
 * Chacun de ces cas correspond à un défaut qui a réellement été rencontré, ou à
 * une garantie qui n'a de sens que sous concurrence : deux onglets ouverts sur
 * le même écran, deux locataires qui cliquent au même instant. Une doublure ne
 * les reproduirait pas — elle prouverait seulement que la doublure est
 * cohérente avec elle-même.
 */
describe('Garanties sous concurrence', () => {
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

  describe('création du dossier locataire', () => {
    it('n’en crée qu’un pour six requêtes simultanées', async () => {
      // Défaut rencontré : la lecture suivie d'une création n'était pas
      // atomique. Deux onglets ouverts sur « Mon dossier » suffisaient à
      // produire un 500 — violation d'unicité, ou conflit de sérialisation dû à
      // l'isolation `Serializable` qui protège la numérotation des références.
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const cookie = await loginAs(tenant.email);

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          api().get('/api/v1/tenant/file').set('Cookie', cookie),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(await h.prisma.tenantFile.count({ where: { tenantId: tenant.id } })).toBe(1);
    });

    it('attribue des références distinctes à des locataires simultanés', async () => {
      const tenants = await Promise.all([
        createUser(h.prisma, UserRole.TENANT),
        createUser(h.prisma, UserRole.TENANT),
        createUser(h.prisma, UserRole.TENANT),
        createUser(h.prisma, UserRole.TENANT),
      ]);
      const cookies = await Promise.all(tenants.map((t) => loginAs(t.email)));

      const responses = await Promise.all(
        cookies.map((cookie) => api().get('/api/v1/tenant/file').set('Cookie', cookie)),
      );

      expect(responses.every((r) => r.status === 200)).toBe(true);
      const references = responses.map((r) => r.body.reference as string);
      expect(new Set(references).size).toBe(4);
    });
  });

  describe('réservation de créneau', () => {
    it('n’attribue le même créneau qu’à un seul locataire', async () => {
      // Sans le filtre `visitId: null` de la mise à jour conditionnelle, deux
      // clics simultanés ouvriraient deux rendez-vous au même horaire — et
      // l'agent serait attendu à deux endroits.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);

      const tenants = await Promise.all([
        createUser(h.prisma, UserRole.TENANT),
        createUser(h.prisma, UserRole.TENANT),
      ]);
      for (const tenant of tenants) {
        const file = await createVerifiedFile(h.prisma, tenant.id);
        await h.prisma.application.create({
          data: {
            propertyId: property.id,
            tenantId: tenant.id,
            tenantFileId: file.id,
            status: 'SHORTLISTED',
          },
        });
      }

      const startsAt = new Date(Date.now() + 5 * 24 * 3600 * 1000);
      startsAt.setUTCMinutes(0, 0, 0);
      const slot = await h.prisma.visitSlot.create({
        data: {
          propertyId: property.id,
          openedById: owner.id,
          startsAt,
          durationMinutes: 30,
          allowedTypes: [VisitType.ACCOMPANIED],
        },
      });

      const cookies = await Promise.all(tenants.map((t) => loginAs(t.email)));
      const responses = await Promise.all(
        cookies.map((cookie) =>
          api()
            .post(`/api/v1/tenant/visits/property/${property.reference}`)
            .set('Cookie', cookie)
            .send({ slotId: slot.id, type: VisitType.ACCOMPANIED }),
        ),
      );

      const accepted = responses.filter((r) => r.status === 201);
      const refused = responses.filter((r) => r.status !== 201);

      expect(accepted).toHaveLength(1);
      expect(refused).toHaveLength(1);
      // Le refus doit dire ce qui s'est passé, pas échouer en 500.
      expect(refused[0].status).toBe(409);

      const visits = await h.prisma.visit.count({ where: { propertyId: property.id } });
      expect(visits).toBe(1);
    });
  });

  describe('candidature', () => {
    it('refuse une seconde candidature du même locataire sur le même bien', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);
      const cookie = await loginAs(tenant.email);

      const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
          api()
            .post(`/api/v1/tenant/applications/${property.reference}`)
            .set('Cookie', cookie)
            .send({}),
        ),
      );

      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await h.prisma.application.count()).toBe(1);
    });
  });

  describe('file d’envoi', () => {
    it('n’enregistre qu’une notification pour un même événement', async () => {
      // La contrainte d'unicité absorbe le doublon, sans que l'appelant ait à
      // s'en soucier — c'est ce qui permet de mettre en file sans réfléchir à
      // chaque point d'appel.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await createVerifiedFile(h.prisma, tenant.id);
      const cookie = await loginAs(tenant.email);

      await api()
        .post(`/api/v1/tenant/applications/${property.reference}`)
        .set('Cookie', cookie)
        .send({})
        .expect(201);

      const application = await h.prisma.application.findFirstOrThrow();

      // Une seconde mise en file du même événement doit être avalée en silence.
      await h.app.get(MailService).enqueue({
        template: EVENT.applicationReceived,
        userId: owner.id,
        subjectRef: application.id,
      });

      expect(
        await h.prisma.emailMessage.count({ where: { template: EVENT.applicationReceived } }),
      ).toBe(1);
    });
  });
});
