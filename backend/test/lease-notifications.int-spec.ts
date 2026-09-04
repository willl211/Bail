import request from 'supertest';
import { LeaseStatus, LeaseType, PaymentStatus, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, type Harness } from './harness';
import { createLeaseTemplate, createProperty, createUser, createVerifiedFile } from './fixtures';
import { EVENT } from '../src/modules/mail/event.templates';
import { EventResolver } from '../src/modules/mail/event.resolver';

/**
 * Notifications du bail et de l'abonnement.
 *
 * Trois des quatre messages qui manquaient sont écrits. Le quatrième —
 * honoraires réglés — n'a toujours aucun point d'appel : rien ne fait passer un
 * règlement à « payé », faute de prestataire branché.
 *
 * **L'envoi en signature n'est pas traversé, et ne peut pas l'être.** Le champ
 * `clausesLegalesTexteValide` est verrouillé : son contenu vient du modèle de
 * l'avocat, le service le laisse vide tant que ce texte n'existe pas, et le
 * contrôle de cohérence refuse alors l'envoi. Monter un décor qui contournerait
 * ce refus reviendrait à tester un produit qui n'existe pas (CLAUDE.md règle 2).
 * Sont donc tenus ici la **reconstruction des messages** et le **câblage de la
 * signature** — le reste s'ouvrira avec le texte de l'avocat, sans que ces
 * gabarits changent.
 */
describe('Notifications de bail et d’abonnement', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());
  const resolver = () => h.app.get(EventResolver);

  const queued = async (template: string) =>
    (
      await h.prisma.emailMessage.findMany({
        where: { template },
        select: { recipientId: true },
      })
    ).map((message) => message.recipientId);

  /** Bail ouvert, tel qu'il existe entre l'attribution et la signature. */
  const openLease = async (status: LeaseStatus = LeaseStatus.SENT_FOR_SIGNATURE) => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    const file = await createVerifiedFile(h.prisma, tenant.id);
    const template = await createLeaseTemplate(h.prisma);

    const application = await h.prisma.application.create({
      data: { propertyId: property.id, tenantId: tenant.id, tenantFileId: file.id },
    });

    const lease = await h.prisma.lease.create({
      data: {
        reference: 'BAIL-2026-0001',
        propertyId: property.id,
        tenantId: tenant.id,
        applicationId: application.id,
        templateId: template.id,
        templateChecksum: template.checksum,
        type: LeaseType.NU,
        fieldValues: {},
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2029-10-01T00:00:00.000Z'),
        durationMonths: 36,
        rentCents: 88_000,
        chargesCents: 8_500,
        depositCents: 88_000,
        status,
        signatureEnvelopeId: 'env-test-1',
        sentForSignatureAt: new Date(),
      },
    });

    return { owner, tenant, property, lease };
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

  describe('bail prêt à signer', () => {
    it('annonce le délai sans faire transiter de lien de signature', async () => {
      // La file ne porte aucun secret : le lien vient du prestataire, dans son
      // propre message. Un jeton dans un e-mail différé serait un jeton qui
      // traîne.
      const { lease, tenant } = await openLease();

      const message = await resolver().resolve(EVENT.leaseReadyToSign, lease.id, tenant.id);

      expect(message?.message.subject).toContain('BAIL-2026-0001');
      expect(message?.message.text).toContain('prestataire de signature');
      expect(message?.message.text).toContain('7 jours');
      expect(message?.message.text).not.toContain('env-test-1');
    });

    it('vaut encore quand une seule des deux parties a signé', async () => {
      const { lease, owner } = await openLease(LeaseStatus.PARTIALLY_SIGNED);

      await expect(
        resolver().resolve(EVENT.leaseReadyToSign, lease.id, owner.id),
      ).resolves.not.toBeNull();
    });

    it('est abandonné si l’acte a été refusé entre-temps', async () => {
      // Le contenu est reconstruit à l'envoi : annoncer « à signer » un acte
      // refusé enverrait quelqu'un sur un lien mort.
      const { lease, tenant } = await openLease(LeaseStatus.DECLINED);

      await expect(
        resolver().resolve(EVENT.leaseReadyToSign, lease.id, tenant.id),
      ).resolves.toBeNull();
    });
  });

  describe('bail signé', () => {
    /** Notification du prestataire, telle qu'elle arrive sur le webhook. */
    const signatureEvent = (id: string, signerId: string) =>
      api()
        .post('/api/v1/leases/signature/webhook')
        .set('Content-Type', 'application/json')
        .send({ id, envelopeId: 'env-test-1', type: 'signed', signerId });

    it('prévient les deux parties une fois les deux signatures reçues', async () => {
      const { owner, tenant, lease } = await openLease();

      await signatureEvent('evt-1', 'LANDLORD').expect(200);
      // Une seule signature : l'acte n'engage pas encore, rien à annoncer.
      expect(await queued(EVENT.leaseSigned)).toEqual([]);
      expect(
        (await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status,
      ).toBe(LeaseStatus.PARTIALLY_SIGNED);

      await signatureEvent('evt-2', 'TENANT').expect(200);

      const destinataires = await queued(EVENT.leaseSigned);
      expect(destinataires).toHaveLength(2);
      expect(destinataires).toEqual(expect.arrayContaining([owner.id, tenant.id]));
    });

    it('ne redit pas la signature sur un rejeu du prestataire', async () => {
      // Les rejeux sont ordinaires chez un prestataire de signature : un même
      // événement ne doit pas produire un second message.
      await openLease();

      await signatureEvent('evt-1', 'LANDLORD').expect(200);
      await signatureEvent('evt-2', 'TENANT').expect(200);
      await signatureEvent('evt-2', 'TENANT').expect(200);

      expect(await queued(EVENT.leaseSigned)).toHaveLength(2);
    });

    it('dit la date de prise d’effet, pas celle de la signature', async () => {
      // C'est la date qui engage, et la seule que le locataire ait à retenir.
      const { lease, tenant } = await openLease(LeaseStatus.SIGNED);

      const message = await resolver().resolve(EVENT.leaseSigned, lease.id, tenant.id);

      expect(message?.message.text).toContain('1 octobre 2026');
    });

    it('est abandonné tant que l’acte n’est pas signé', async () => {
      const { lease, tenant } = await openLease(LeaseStatus.PARTIALLY_SIGNED);

      await expect(
        resolver().resolve(EVENT.leaseSigned, lease.id, tenant.id),
      ).resolves.toBeNull();
    });
  });

  describe('échéance d’abonnement refusée', () => {
    const payment = async (status: PaymentStatus, reason: string | null) => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const subscription = await h.prisma.subscription.create({
        data: { ownerId: owner.id, monthlyAmountCents: 1_900 },
      });
      const row = await h.prisma.payment.create({
        data: {
          reference: `PAY-2026-${String(Date.now()).slice(-6)}`,
          type: 'OWNER_SUBSCRIPTION',
          status,
          payerId: owner.id,
          subscriptionId: subscription.id,
          amountCents: 1_900,
          failureReason: reason,
          failedAt: status === PaymentStatus.FAILED ? new Date() : null,
        },
      });
      return { owner, row };
    };

    it('reprend le motif de la banque', async () => {
      const { owner, row } = await payment(PaymentStatus.FAILED, 'Provision insuffisante');

      const message = await resolver().resolve(
        EVENT.subscriptionPaymentFailed,
        row.id,
        owner.id,
      );

      expect(message?.message.text).toContain('Provision insuffisante');
      // Sans dramatiser : la diffusion continue, le prestataire relance. Le dire
      // évite qu'un propriétaire retire son bien par précaution.
      expect(message?.message.text).toContain('restent en ligne');
    });

    it('se passe de motif quand la banque n’en donne pas', async () => {
      const { owner, row } = await payment(PaymentStatus.FAILED, null);

      const message = await resolver().resolve(
        EVENT.subscriptionPaymentFailed,
        row.id,
        owner.id,
      );

      expect(message?.message.text).not.toContain('Motif indiqué');
    });

    it('est abandonné si l’échéance a finalement été réglée', async () => {
      const { owner, row } = await payment(PaymentStatus.PAID, null);

      await expect(
        resolver().resolve(EVENT.subscriptionPaymentFailed, row.id, owner.id),
      ).resolves.toBeNull();
    });
  });
});
