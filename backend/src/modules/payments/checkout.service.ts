import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, PaymentType, Prisma, SubscriptionStatus, type PaymentCheckout } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { visiblePropertyWhere } from '../properties/property-visibility';
import { MailService } from '../mail/mail.service';
import { EVENT } from '../mail/event.templates';
import { PAYMENT_DRIVER, type CheckoutInput, type DriverCheckout, type DriverSubscription, type PaymentDriver, type WebhookEvent } from './payment.driver';

export const subscriptionStatus = (status: DriverSubscription['status']): SubscriptionStatus => ({
  incomplete: 'INCOMPLETE', active: 'ACTIVE', trialing: 'TRIALING', past_due: 'PAST_DUE', canceled: 'CANCELLED',
})[status] as SubscriptionStatus;

/** Checkout hébergé. Les paramètres et la clé d'idempotence précèdent tout appel réseau. */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_DRIVER) private readonly driver: PaymentDriver,
    private readonly mail: MailService,
  ) {}

  returnUrl(path: string): string {
    const origin = new URL(this.config.get<string>('integrations.payment.returnOrigin', 'http://localhost:3000'));
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
      throw new BadRequestException('Adresse de retour des paiements invalide.');
    }
    return new URL(path, origin.origin).toString();
  }

  private async reserve(scope: string, build: (tx: Prisma.TransactionClient) => Promise<{
    payerId: string; resourceId: string; kind: PaymentType; input: CheckoutInput;
  }>): Promise<PaymentCheckout> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
      const known = await tx.paymentCheckout.findUnique({ where: { activeScope: scope } });
      if (known) return known;
      const data = await build(tx);
      return tx.paymentCheckout.create({ data: { ...data, activeScope: scope, input: data.input as unknown as Prisma.InputJsonValue } });
    });
  }

  async startFees(leaseReference: string, tenantId: string): Promise<{ checkoutUrl: string }> {
    const flow = await this.reserve(`fees:${leaseReference}`, async tx => {
      const lease = await tx.lease.findFirst({ where: { reference: leaseReference, tenantId }, include: { property: true, tenant: true } });
      if (!lease) throw new NotFoundException('Bail introuvable.');
      const schedule = await tx.feeSchedule.findFirst({ where: { isActive: true }, orderBy: { effectiveFrom: 'desc' } });
      if (lease.status !== 'SIGNED' || !schedule?.isLegallyApproved) throw new BadRequestException('Bail signé et barème validé requis.');
      const existing = await tx.payment.findFirst({ where: { leaseId: lease.id, type: 'TENANT_FEE', status: { in: ['PAID', 'REFUNDED', 'PENDING', 'AUTHORIZED'] } } });
      if (existing) throw new ConflictException('Un règlement existe déjà. Vérifiez son statut avant de réessayer.');
      const amountCents = Math.round(lease.property.surfaceM2 * schedule.tenantVisitFeeCentsPerSqm)
        + Math.round(lease.property.surfaceM2 * schedule.tenantInventoryFeeCentsPerSqm);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new BadRequestException('Montant des honoraires invalide.');
      const payment = await tx.payment.create({ data: {
        reference: `HON-${new Date().getFullYear()}-${randomUUID()}`, type: 'TENANT_FEE', payerId: tenantId,
        propertyId: lease.propertyId, leaseId: lease.id, applicationId: lease.applicationId,
        amountCents, tenantShareCents: amountCents, feeScheduleId: schedule.id,
        providerPayload: { surfaceM2: lease.property.surfaceM2,
          draftingCents: Math.round(lease.property.surfaceM2 * schedule.tenantVisitFeeCentsPerSqm),
          inventoryCents: Math.round(lease.property.surfaceM2 * schedule.tenantInventoryFeeCentsPerSqm), driver: this.driver.name },
      } });
      const returnPath = `/baux/${encodeURIComponent(leaseReference)}/honoraires`;
      return { payerId: tenantId, resourceId: payment.id, kind: PaymentType.TENANT_FEE, input: {
        mode: 'payment', userId: tenantId, resourceId: payment.id, email: lease.tenant.email,
        amountCents, quantity: 1, label: `whoma — honoraires ${leaseReference}`,
        successUrl: this.returnUrl(`${returnPath}?paiement=retour`), cancelUrl: this.returnUrl(`${returnPath}?paiement=annule`),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      } };
    });
    if (flow.payerId !== tenantId) throw new NotFoundException('Bail introuvable.');
    return this.open(flow);
  }

  async startSubscription(ownerId: string): Promise<{ checkoutUrl: string }> {
    const flow = await this.reserve(`subscription:${ownerId}`, async tx => {
      if (await tx.subscription.findFirst({ where: { ownerId, status: { not: 'CANCELLED' } } })) {
        throw new ConflictException('Un abonnement existe déjà sur ce compte.');
      }
      const schedule = await tx.feeSchedule.findFirst({ where: { isActive: true }, orderBy: { effectiveFrom: 'desc' } });
      if (!schedule?.isLegallyApproved || schedule.ownerSubscriptionMonthlyCents <= 0) {
        throw new BadRequestException('Un barème actif validé juridiquement est nécessaire.');
      }
      const owner = await tx.user.findUniqueOrThrow({ where: { id: ownerId } });
      const quantity = await tx.property.count({ where: { ownerId, ...visiblePropertyWhere() } });
      const subscription = await tx.subscription.create({ data: {
        ownerId, status: 'INCOMPLETE', feeScheduleId: schedule.id, monthlyAmountCents: schedule.ownerSubscriptionMonthlyCents,
      } });
      return { payerId: ownerId, resourceId: subscription.id, kind: PaymentType.OWNER_SUBSCRIPTION, input: {
        mode: quantity === 0 ? 'setup' : 'subscription', userId: ownerId, resourceId: subscription.id, email: owner.email,
        quantity, amountCents: schedule.ownerSubscriptionMonthlyCents, label: 'whoma — abonnement par bien diffusé',
        successUrl: this.returnUrl('/proprietaires/abonnement?paiement=retour'),
        cancelUrl: this.returnUrl('/proprietaires/abonnement?paiement=annule'),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      } };
    });
    return this.open(flow);
  }

  private async open(flow: PaymentCheckout): Promise<{ checkoutUrl: string }> {
    if (flow.completedAt) throw new ConflictException('Ce paiement est confirmé. Actualisez la page.');
    // Une réponse perdue ne justifie jamais de changer la clé. Après 23 h, intervention
    // nécessaire : Stripe peut oublier les clés après 24 h. L'expiration fixe protège aussi les reprises.
    if (!flow.providerSessionId && Date.now() - flow.createdAt.getTime() > 23 * 3600_000) {
      throw new ConflictException('Cette tentative doit être vérifiée par un administrateur avant un nouveau paiement.');
    }
    let session: DriverCheckout;
    if (flow.providerSessionId) session = await this.driver.retrieveCheckout(flow.providerSessionId);
    else {
      const created = await this.driver.createCheckout(flow.input as unknown as CheckoutInput, flow.id);
      await this.prisma.paymentCheckout.update({ where: { id: flow.id }, data: { providerSessionId: created.id } });
      session = await this.driver.retrieveCheckout(created.id);
    }
    await this.reconcile(flow, session);
    if (session.status === 'expired') throw new ConflictException('La session a expiré. Cliquez à nouveau pour ouvrir un nouveau paiement.');
    if (session.status !== 'open' || !session.url) throw new ConflictException('Paiement transmis. Actualisez la page pour consulter sa confirmation.');
    const url = new URL(session.url);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new BadRequestException('Adresse Stripe invalide.');
    return { checkoutUrl: session.url };
  }

  async handleWebhook(event: WebhookEvent): Promise<boolean> {
    if (!event.type.startsWith('checkout.session.') && !event.type.startsWith('payment_intent.')) return false;
    const metadata = event.data.metadata as { checkoutId?: unknown } | undefined;
    const id = metadata?.checkoutId;
    const flow = typeof id === 'string' ? await this.prisma.paymentCheckout.findUnique({ where: { id } }) : null;
    if (!flow) return false;
    let sessionId = flow.providerSessionId;
    if (event.type.startsWith('checkout.session.') && typeof event.data.id === 'string') sessionId = event.data.id;
    // L'événement peut précéder la réponse de création : Stripe le rejouera.
    if (!sessionId) throw new ConflictException('Session en cours de rattachement.');
    const session = await this.driver.retrieveCheckout(sessionId);
    await this.reconcile(flow, session);
    if (event.type === 'payment_intent.payment_failed' && flow.kind === 'TENANT_FEE' && session.status === 'open') {
      await this.prisma.payment.updateMany({ where: { id: flow.resourceId, status: 'PENDING' }, data: {
        status: 'FAILED', failedAt: new Date(), failureReason: 'Carte refusée. Reprenez le paiement pour réessayer dans Stripe.',
      } });
    }
    return true;
  }

  private async reconcile(flow: PaymentCheckout, session: DriverCheckout): Promise<void> {
    const input = flow.input as unknown as CheckoutInput;
    if (session.checkoutId !== flow.id || session.mode !== input.mode || (flow.providerSessionId && flow.providerSessionId !== session.id)) {
      throw new BadRequestException('Session Stripe incohérente.');
    }
    if (session.status === 'expired') {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.paymentCheckout.updateMany({ where: { id: flow.id, completedAt: null, expiredAt: null }, data: { expiredAt: new Date(), activeScope: null, providerSessionId: session.id } });
        if (!changed.count) return;
        if (flow.kind === 'TENANT_FEE') await tx.payment.updateMany({ where: { id: flow.resourceId, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED' } });
        else await tx.subscription.updateMany({ where: { id: flow.resourceId, status: 'INCOMPLETE', stripeSubscriptionId: null }, data: { status: 'CANCELLED' } });
      });
      return;
    }
    if (session.status !== 'complete' || !session.paid) return;
    if (input.mode !== 'setup' && (session.currency !== 'eur' || session.amountCents !== input.amountCents * input.quantity)) {
      throw new BadRequestException('Montant ou devise Stripe incohérent.');
    }
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${flow.id}`}))`;
      const current = await tx.paymentCheckout.findUniqueOrThrow({ where: { id: flow.id } });
      if (current.completedAt) return;
      if (flow.kind === 'TENANT_FEE') {
        if (!session.paymentIntentId) throw new BadRequestException('Paiement Stripe absent.');
        await tx.payment.updateMany({ where: { id: flow.resourceId, status: { in: ['PENDING', 'FAILED'] } }, data: {
          status: 'PAID', paidAt: new Date(), failedAt: null, failureReason: null, stripePaymentIntentId: session.paymentIntentId,
        } });
      } else {
        const local = await tx.subscription.findUniqueOrThrow({ where: { id: flow.resourceId } });
        if (!local.stripeSubscriptionId && input.mode === 'setup' && Date.now() - flow.createdAt.getTime() > 23 * 3600_000) {
          throw new ConflictException('Abonnement à rapprocher manuellement avant une nouvelle création.');
        }
        const subscription = local.stripeSubscriptionId
          ? await this.driver.retrieveSubscription(local.stripeSubscriptionId)
          : await this.driver.subscriptionFromCheckout(session, input, flow.id);
        if (subscription.localSubscriptionId !== local.id || subscription.customerId !== session.customerId) throw new BadRequestException('Abonnement Stripe incohérent.');
        await tx.subscription.update({ where: { id: local.id }, data: {
          status: subscriptionStatus(subscription.status), stripeSubscriptionId: subscription.id,
          stripeCustomerId: subscription.customerId, currentPeriodEnd: subscription.currentPeriodEnd, cancelledAt: subscription.cancelledAt,
        } });
        // Si le portefeuille a changé pendant Checkout, la tâche existante reprend la synchronisation.
        await tx.property.updateMany({ where: { ownerId: flow.payerId }, data: { publicationBillingSyncPending: true } });
      }
      await tx.paymentCheckout.update({ where: { id: flow.id }, data: { completedAt: new Date(), providerSessionId: session.id, activeScope: null } });
    }, { timeout: 20_000 });
  }

  /** Relecture canonique : les notifications en retard ne rétrogradent pas un paiement réussi. */
  async handleBillingWebhook(event: WebhookEvent): Promise<boolean> {
    const invoiceEvent = ['invoice.created', 'invoice.finalized', 'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.voided'].includes(event.type);
    const subscriptionEvent = ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type);
    if ((!invoiceEvent && !subscriptionEvent) || typeof event.data.id !== 'string') return false;
    const invoice = invoiceEvent ? await this.driver.retrieveInvoice(event.data.id) : null;
    const parent = invoice?.parent as { subscription_details?: { subscription?: string } } | undefined;
    const subscriptionId = invoiceEvent ? (invoice?.subscription ?? parent?.subscription_details?.subscription) : event.data.id;
    if (typeof subscriptionId !== 'string') return false;
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${subscriptionId}`}))`;
      const remote = await this.driver.retrieveSubscription(subscriptionId);
      const local = await tx.subscription.findFirst({ where: { OR: [
        { stripeSubscriptionId: subscriptionId }, ...(remote.localSubscriptionId ? [{ id: remote.localSubscriptionId }] : []),
      ] } });
      if (!local) return;
      if ((local.stripeSubscriptionId && local.stripeSubscriptionId !== remote.id) || (local.stripeCustomerId && local.stripeCustomerId !== remote.customerId)) throw new BadRequestException('Client Stripe incohérent.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-owner:${local.ownerId}`}))`;
      await tx.subscription.update({ where: { id: local.id }, data: {
        stripeSubscriptionId: remote.id, stripeCustomerId: remote.customerId,
        status: subscriptionStatus(remote.status), currentPeriodEnd: remote.currentPeriodEnd,
        cancelledAt: remote.status === 'canceled' ? (local.cancelledAt ?? new Date()) : remote.cancelledAt ?? null,
      } });
      if (remote.status === 'canceled') {
        const latest = await tx.subscription.findFirst({ where: { ownerId: local.ownerId }, orderBy: { createdAt: 'desc' } });
        if (latest?.id === local.id) {
          const properties = await tx.property.findMany({ where: { ownerId: local.ownerId, status: { in: ['ONLINE', 'VISITS_IN_PROGRESS'] } } });
          for (const property of properties) {
            const note = 'Diffusion interrompue : l’abonnement propriétaire a pris fin.';
            const changed = await tx.property.updateMany({ where: { id: property.id, reviewRevision: property.reviewRevision, status: property.status },
              data: { status: 'DRAFT', reviewRevision: { increment: 1 }, reviewNote: note, publicationBillingSyncPending: true } });
            if (changed.count) await tx.propertyReviewEvent.create({ data: {
              propertyId: property.id, revision: property.reviewRevision + 1, actorLabel: 'Facturation', action: 'PUBLICATION_SUSPENDED',
              title: 'Annonce retirée de la diffusion', note,
            } });
          }
        }
      }
      if (!invoice) return;
      // Relecture sous verrou pour deux événements concurrents concernant la même facture.
      const current = await this.driver.retrieveInvoice(event.data.id as string);
      if (current.currency !== 'eur' || current.customer !== remote.customerId) throw new BadRequestException('Facture Stripe incohérente.');
      const paid = current.status === 'paid';
      const amount = paid ? current.amount_paid : current.amount_due;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) throw new BadRequestException('Montant de facture invalide.');
      const known = await tx.payment.findFirst({ where: { subscriptionId: local.id, stripePaymentIntentId: current.id as string } });
      if (known?.status === 'PAID' || known?.status === 'REFUNDED') return;
      const status: PaymentStatus = paid ? 'PAID' : current.status === 'void' ? 'CANCELLED' : current.attempted === true ? 'FAILED' : 'PENDING';
      const lines = current.lines as { data?: { quantity?: number }[] } | undefined;
      const data = { status, amountCents: amount, ownerShareCents: amount, paidAt: paid ? new Date() : null,
        failedAt: status === 'FAILED' ? new Date() : null, failureReason: status === 'FAILED' ? 'Paiement refusé. Actualisez votre moyen de paiement dans Stripe.' : null,
        providerPayload: { propertyCount: lines?.data?.[0]?.quantity ?? 0, driver: this.driver.name },
      };
      const payment = known ? await tx.payment.update({ where: { id: known.id }, data })
      : await tx.payment.create({ data: { ...data, reference: `FAC-${new Date().getFullYear()}-${randomUUID()}`,
        type: 'OWNER_SUBSCRIPTION', payerId: local.ownerId, subscriptionId: local.id, feeScheduleId: local.feeScheduleId,
        stripePaymentIntentId: current.id as string,
      } });
      if (status === 'FAILED') await this.mail.enqueueInTransaction(tx, {
        template: EVENT.subscriptionPaymentFailed, userId: local.ownerId, subjectRef: payment.id,
      });
    }, { timeout: 20_000 });
    return true;
  }
}
