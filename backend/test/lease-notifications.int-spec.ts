import request from 'supertest';
import { jest } from '@jest/globals';
import { LeaseStatus, LeaseType, PaymentStatus, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import {
  createLeaseTemplate,
  createProperty,
  createUser,
  createVerifiedFile,
  TEST_PASSWORD,
} from './fixtures';
import { MailService } from '../src/modules/mail/mail.service';
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
  let agentCookie: string;
  const api = () => request(h.app.getHttpServer());
  const resolver = () => h.app.get(EventResolver);
  const webhook = (body: object) =>
    api()
      .post('/api/v1/leases/signature/webhook')
      .set('Cookie', agentCookie)
      .set('Content-Type', 'application/json')
      .send(body);

  const queued = async (template: string) =>
    (
      await h.prisma.emailMessage.findMany({
        where: { template },
        select: { recipientId: true },
      })
    ).map((message) => message.recipientId);

  /** Bail ouvert, tel qu'il existe entre l'attribution et la signature. */
  const openLease = async (status: LeaseStatus = LeaseStatus.SENT_FOR_SIGNATURE) => {
    const agent = await createUser(h.prisma, UserRole.AGENT);
    agentCookie = sessionCookie(
      await api()
        .post('/api/v1/auth/login')
        .send({ email: agent.email, password: TEST_PASSWORD })
        .expect(200),
    );
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
        signatureProvider: 'mock',
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
      webhook({ id, envelopeId: 'env-test-1', type: 'signed', signerId });

    it('compte une seule signature pour deux notifications différentes du bailleur, jusque dans le registre', async () => {
      const { lease, owner } = await openLease();
      await signatureEvent('evt-1', 'LANDLORD').expect(200);
      await signatureEvent('evt-2', 'LANDLORD').expect(200);
      const current = await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } });
      expect(current.status).toBe('PARTIALLY_SIGNED');
      expect(current.signedAt).toBeNull();
      expect(await queued(EVENT.leaseSigned)).toEqual([]);
      const admin = await api().get('/api/v1/admin/leases').set('Cookie', agentCookie).expect(200);
      expect(admin.body[0].signedCount).toBe(1);
      const ownerCookie = sessionCookie(
        await api()
          .post('/api/v1/auth/login')
          .send({ email: owner.email, password: TEST_PASSWORD })
          .expect(200),
      );
      const view = await api()
        .get(`/api/v1/leases/${lease.reference}`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(view.body.signers.map((signer: { signed: boolean }) => signer.signed)).toEqual([
        true,
        false,
      ]);
    });

    it('ne considère pas completed comme la preuve des signatures manquantes, quel que soit l’ordre de réception', async () => {
      const { lease } = await openLease();
      await webhook({ id: 'completed-first', envelopeId: 'env-test-1', type: 'completed' }).expect(
        200,
      );
      expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'SENT_FOR_SIGNATURE',
      );
      await signatureEvent('tenant-first', 'TENANT').expect(200);
      await webhook({ id: 'completed-again', envelopeId: 'env-test-1', type: 'completed' }).expect(
        200,
      );
      expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'PARTIALLY_SIGNED',
      );
      expect(await queued(EVENT.leaseSigned)).toEqual([]);
      await signatureEvent('landlord-last', 'LANDLORD').expect(200);
      expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'SIGNED',
      );
    });

    it('conserve les deux signatures reçues simultanément et une seule notification par partie', async () => {
      const { lease } = await openLease();
      const responses = await Promise.all([
        signatureEvent('concurrent-owner', 'LANDLORD'),
        signatureEvent('concurrent-tenant', 'TENANT'),
        signatureEvent('concurrent-owner', 'LANDLORD'),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      const current = await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } });
      expect(current.status).toBe('SIGNED');
      expect(current.signatureEvents).toHaveLength(2);
      expect(await queued(EVENT.leaseSigned)).toHaveLength(2);
    });

    it.each([
      LeaseStatus.SIGNED,
      LeaseStatus.DECLINED,
      LeaseStatus.CANCELLED,
      LeaseStatus.EXPIRED,
      LeaseStatus.DRAFT,
      LeaseStatus.FIELDS_VALIDATED,
    ])('ne modifie pas un bail %s avec des événements tardifs ou hors parcours', async (status) => {
      const { lease } = await openLease(status);
      const before = await h.prisma.lease.update({
        where: { id: lease.id },
        data: {
          signedAt: status === 'SIGNED' ? new Date('2026-09-01T10:00:00Z') : null,
          declinedAt: status === 'DECLINED' ? new Date('2026-09-01T10:00:00Z') : null,
          declineReason: status === 'DECLINED' ? 'Motif initial' : null,
        },
      });
      await signatureEvent('late-owner', 'LANDLORD').expect(200);
      await signatureEvent('late-tenant', 'TENANT').expect(200);
      for (const type of ['completed', 'declined', 'voided', 'delivered']) {
        await webhook({ id: 'late-' + type, envelopeId: 'env-test-1', type }).expect(200);
      }
      expect(await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).toEqual(before);
      expect(await queued(EVENT.leaseSigned)).toEqual([]);
    });

    it('fige la date sur les premières signatures des deux parties, malgré les doublons et les livraisons tardives', async () => {
      const { lease } = await openLease();
      const dated = (id: string, signerId: string, occurredAt: string) =>
        webhook({ id, envelopeId: 'env-test-1', type: 'signed', signerId, occurredAt });
      await dated('owner', 'LANDLORD', '2026-09-09T09:00:00Z').expect(200);
      await dated('duplicate-owner', 'LANDLORD', '2026-09-09T12:00:00Z').expect(200);
      await dated('tenant', 'TENANT', '2026-09-09T10:00:00Z').expect(200);
      await webhook({ id: 'delivered-late', envelopeId: 'env-test-1', type: 'delivered' }).expect(
        200,
      );
      expect(
        (
          await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })
        ).signedAt?.toISOString(),
      ).toBe('2026-09-09T10:00:00.000Z');
    });

    it.each([
      { id: 'unknown-signer', type: 'signed', signerId: 'OTHER' },
      { id: 'missing-signer', type: 'signed' },
      { id: 'unknown-type', type: 'approved' },
      { type: 'signed', signerId: 'LANDLORD' },
      { id: 'date', type: 'signed', signerId: 'LANDLORD', occurredAt: 'not-a-date' },
    ])('refuse une notification invalide : %j', async (body) => {
      const { lease } = await openLease();
      await webhook({ envelopeId: 'env-test-1', ...body }).expect(400);
      expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'SENT_FOR_SIGNATURE',
      );
      expect(await queued(EVENT.leaseSigned)).toEqual([]);
    });

    it('refuse les simulations anonymes et celles provenant d’un compte propriétaire', async () => {
      const { owner } = await openLease();
      const payload = {
        id: 'untrusted',
        envelopeId: 'env-test-1',
        type: 'signed',
        signerId: 'LANDLORD',
      };
      await api().post('/api/v1/leases/signature/webhook').send(payload).expect(403);
      const cookie = sessionCookie(
        await api()
          .post('/api/v1/auth/login')
          .send({ email: owner.email, password: TEST_PASSWORD })
          .expect(200),
      );
      await api()
        .post('/api/v1/leases/signature/webhook')
        .set('Cookie', cookie)
        .send(payload)
        .expect(403);
    });

    it('ne signe aucun bail quand l’enveloppe est inconnue', async () => {
      const { lease } = await openLease();
      const response = await webhook({
        id: 'unknown',
        envelopeId: 'another-envelope',
        type: 'signed',
        signerId: 'TENANT',
      }).expect(200);
      expect(response.body.handled).toBe(false);
      expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'SENT_FOR_SIGNATURE',
      );
    });

    it('annule la transition si la mise en file échoue, puis permet un rejeu complet', async () => {
      const { lease } = await openLease();
      await signatureEvent('owner', 'LANDLORD').expect(200);
      const queue = jest.spyOn(h.app.get(MailService), 'enqueueInTransaction');
      queue.mockRejectedValueOnce(new Error('Test de panne de la file'));
      try {
        await signatureEvent('tenant', 'TENANT').expect(500);
        expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
          'PARTIALLY_SIGNED',
        );
        expect(await queued(EVENT.leaseSigned)).toEqual([]);
      } finally {
        queue.mockRestore();
      }
      await signatureEvent('tenant', 'TENANT').expect(200);
      expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'SIGNED',
      );
      expect(await queued(EVENT.leaseSigned)).toHaveLength(2);
    });

    it('prévient les deux parties une fois les deux signatures reçues', async () => {
      const { owner, tenant, lease } = await openLease();

      await signatureEvent('evt-1', 'LANDLORD').expect(200);
      // Une seule signature : l'acte n'engage pas encore, rien à annoncer.
      expect(await queued(EVENT.leaseSigned)).toEqual([]);
      expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        LeaseStatus.PARTIALLY_SIGNED,
      );

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

      await expect(resolver().resolve(EVENT.leaseSigned, lease.id, tenant.id)).resolves.toBeNull();
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

      const message = await resolver().resolve(EVENT.subscriptionPaymentFailed, row.id, owner.id);

      expect(message?.message.text).toContain('Provision insuffisante');
      // Sans dramatiser : la diffusion continue, le prestataire relance. Le dire
      // évite qu'un propriétaire retire son bien par précaution.
      expect(message?.message.text).toContain('restent en ligne');
    });

    it('se passe de motif quand la banque n’en donne pas', async () => {
      const { owner, row } = await payment(PaymentStatus.FAILED, null);

      const message = await resolver().resolve(EVENT.subscriptionPaymentFailed, row.id, owner.id);

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
