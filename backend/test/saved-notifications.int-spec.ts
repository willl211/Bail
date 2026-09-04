import request from 'supertest';
import {
  ApplicationStatus,
  PropertyDocumentType,
  PropertyStatus,
  UserRole,
} from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import {
  TEST_PASSWORD,
  createLeaseTemplate,
  createProperty,
  createUser,
  createVerifiedFile,
} from './fixtures';
import { EVENT } from '../src/modules/mail/event.templates';
import { EventResolver } from '../src/modules/mail/event.resolver';

/**
 * Notifications sur un bien mis de côté.
 *
 * Ce sont les seuls messages du produit qui apportent une nouvelle sans qu'on
 * ait rien demandé. Ils doivent donc être rares et exacts, et cette suite tient
 * les trois façons de les rendre faux : prévenir quelqu'un qui sait déjà,
 * annoncer une baisse qui n'en est pas une pour lui, ou annoncer un prix qui
 * n'a plus cours au moment où le message part.
 */
describe('Notifications sur un bien mis de côté', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());

  const loginAs = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return sessionCookie(response);
  };

  /** Met un bien de côté au loyer indiqué, sans passer par la route. */
  const save = (tenantId: string, propertyId: string, rentCentsAtSave: number) =>
    h.prisma.savedProperty.create({ data: { tenantId, propertyId, rentCentsAtSave } });

  const queued = async (template: string) =>
    (
      await h.prisma.emailMessage.findMany({
        where: { template },
        select: { recipientId: true },
      })
    ).map((message) => message.recipientId);

  /**
   * Bien remis au contrôle, prêt à être publié.
   *
   * Le DPE est la seule pièce que `propertyChecks` exige en plus de ce que
   * pose la fabrique : sans elle, la publication échoue en 400 avant
   * d'atteindre ce que ces cas vérifient.
   */
  const submitForReview = async (propertyId: string, totalRentCents: number) => {
    await h.prisma.propertyDocument.create({
      data: {
        propertyId,
        type: PropertyDocumentType.DPE,
        storageKey: `tests/${propertyId}/dpe.pdf`,
      },
    });
    await h.prisma.property.update({
      where: { id: propertyId },
      data: {
        status: PropertyStatus.PENDING_REVIEW,
        rentCents: totalRentCents,
        chargesCents: 0,
      },
    });
  };

  const publish = async (reference: string) => {
    const agent = await createUser(h.prisma, UserRole.AGENT);
    await api()
      .post(`/api/v1/admin/properties/${reference}/decision`)
      .set('Cookie', await loginAs(agent.email))
      .send({ decision: 'PUBLISH' })
      .expect(200);
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

  describe('baisse de loyer', () => {
    it('prévient à la republication celui dont le loyer de référence était plus haut', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await save(tenant.id, property.id, 90_000);

      await submitForReview(property.id, 80_000);
      await publish(property.reference);

      expect(await queued(EVENT.savedPropertyPriceDrop)).toEqual([tenant.id]);
    });

    it('ne prévient pas celui pour qui le loyer n’a pas baissé', async () => {
      // Une hausse ne se notifie pas : personne n'a demandé à apprendre qu'un
      // logement s'éloignait de lui.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const [egal, plusBas] = await Promise.all([
        createUser(h.prisma, UserRole.TENANT),
        createUser(h.prisma, UserRole.TENANT),
      ]);
      await save(egal.id, property.id, 80_000);
      await save(plusBas.id, property.id, 70_000);

      await submitForReview(property.id, 80_000);
      await publish(property.reference);

      expect(await queued(EVENT.savedPropertyPriceDrop)).toEqual([]);
    });

    it('ne prévient pas celui qui a déjà candidaté', async () => {
      // Il suit son dossier sur l'écran de candidature, et reçoit déjà les
      // messages qui s'y rapportent.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const file = await createVerifiedFile(h.prisma, tenant.id);
      await save(tenant.id, property.id, 90_000);
      await h.prisma.application.create({
        data: { propertyId: property.id, tenantId: tenant.id, tenantFileId: file.id },
      });

      await submitForReview(property.id, 80_000);
      await publish(property.reference);

      expect(await queued(EVENT.savedPropertyPriceDrop)).toEqual([]);
    });

    it('ne se redit pas pour un même palier de prix', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await save(tenant.id, property.id, 90_000);

      await submitForReview(property.id, 80_000);
      await publish(property.reference);
      // Retiré puis republié au même prix : rien de nouveau à annoncer.
      await h.prisma.property.update({
        where: { id: property.id },
        data: { status: PropertyStatus.PENDING_REVIEW },
      });
      await publish(property.reference);

      expect(await queued(EVENT.savedPropertyPriceDrop)).toHaveLength(1);
    });

    it('repart si le loyer baisse encore', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await save(tenant.id, property.id, 90_000);

      await submitForReview(property.id, 80_000);
      await publish(property.reference);
      await h.prisma.property.update({
        where: { id: property.id },
        data: { status: PropertyStatus.PENDING_REVIEW, rentCents: 72_000 },
      });
      await publish(property.reference);

      expect(await queued(EVENT.savedPropertyPriceDrop)).toHaveLength(2);
    });
  });

  describe('bien loué', () => {
    it('prévient ceux qui suivaient sans avoir candidaté', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      await createLeaseTemplate(h.prisma);

      const [retenu, suiveur] = await Promise.all([
        createUser(h.prisma, UserRole.TENANT),
        createUser(h.prisma, UserRole.TENANT),
      ]);
      const file = await createVerifiedFile(h.prisma, retenu.id);
      const candidature = await h.prisma.application.create({
        data: {
          propertyId: property.id,
          tenantId: retenu.id,
          tenantFileId: file.id,
          status: ApplicationStatus.SHORTLISTED,
        },
      });
      // Le candidat retenu suit aussi le bien : il ne doit pas recevoir deux
      // messages pour le même fait.
      await save(retenu.id, property.id, 80_000);
      await save(suiveur.id, property.id, 80_000);

      await api()
        .post(`/api/v1/owner/applications/${candidature.id}/accept`)
        .set('Cookie', await loginAs(owner.email))
        .expect(200);

      expect(await queued(EVENT.savedPropertyRented)).toEqual([suiveur.id]);
    });
  });

  describe('reconstruction au moment de l’envoi', () => {
    const resolver = () => h.app.get(EventResolver);

    it('abandonne si le bien a été retiré de la liste', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);

      await expect(
        resolver().resolve(EVENT.savedPropertyPriceDrop, property.id, tenant.id),
      ).resolves.toBeNull();
    });

    it('abandonne si le loyer est remonté avant l’envoi', async () => {
      // Le message annoncerait un prix qui n'a plus cours, et ferait venir
      // quelqu'un pour rien.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await save(tenant.id, property.id, 90_000);

      await h.prisma.property.update({
        where: { id: property.id },
        data: { rentCents: 80_000, chargesCents: 0 },
      });
      const avant = await resolver().resolve(
        EVENT.savedPropertyPriceDrop,
        property.id,
        tenant.id,
      );
      expect(avant?.message.subject).toContain('Baisse de loyer');
      expect(avant?.message.text).toContain('100 €');

      await h.prisma.property.update({
        where: { id: property.id },
        data: { rentCents: 95_000 },
      });
      await expect(
        resolver().resolve(EVENT.savedPropertyPriceDrop, property.id, tenant.id),
      ).resolves.toBeNull();
    });

    it('abandonne l’annonce d’une location si le bien est toujours en ligne', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      await save(tenant.id, property.id, 80_000);

      await expect(
        resolver().resolve(EVENT.savedPropertyRented, property.id, tenant.id),
      ).resolves.toBeNull();

      await h.prisma.property.update({
        where: { id: property.id },
        data: { status: PropertyStatus.RENTED, rentedAt: new Date() },
      });
      const message = await resolver().resolve(
        EVENT.savedPropertyRented,
        property.id,
        tenant.id,
      );
      expect(message?.message.subject).toContain('Bien loué');
    });
  });
});
