import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentStatus,
  PaymentType,
  Prisma,
  PropertyStatus,
  SubscriptionStatus,
  type Subscription,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT } from '../mail/event.templates';
import { MailService } from '../mail/mail.service';
import {
  PAYMENT_DRIVER,
  type DriverSubscription,
  type PaymentDriver,
  type WebhookEvent,
} from './payment.driver';

/**
 * Facture telle qu'elle arrive du prestataire.
 *
 * Volontairement en `unknown` : la charge vient de l'extérieur, sa forme peut
 * changer d'une version d'API à l'autre, et la typer optimistement reviendrait
 * à supposer vrai ce qu'on n'a pas vérifié. Les lecteurs ci-dessous font la
 * vérification.
 */
type InvoiceShape = Record<string, unknown>;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Les horodatages du prestataire sont en secondes, pas en millisecondes. */
const readDate = (value: unknown): Date | null => {
  const seconds = readNumber(value);
  return seconds === null ? null : new Date(seconds * 1000);
};

/**
 * Identifiant d'abonnement porté par une facture.
 *
 * Les versions récentes de l'API Stripe l'ont déplacé de `subscription` vers
 * `parent.subscription_details.subscription` : on lit les deux, pour ne pas
 * dépendre de la version négociée par le compte au moment de la bascule.
 */
const readSubscriptionId = (invoice: InvoiceShape): string | null => {
  const direct = readString(invoice.subscription);
  if (direct) return direct;

  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | null;
  return readString(parent?.subscription_details?.subscription);
};

/** Nombre de biens facturés sur la facture, lu sur sa première ligne. */
const readInvoiceQuantity = (invoice: InvoiceShape): number => {
  const lines = invoice.lines as { data?: { quantity?: unknown }[] } | null;
  return readNumber(lines?.data?.[0]?.quantity) ?? 0;
};

/** Message d'échec, quand le prestataire en fournit un. */
const readFailureReason = (invoice: InvoiceShape): string | null => {
  const error = invoice.last_finalization_error as { message?: unknown } | null;
  return readString(error?.message);
};

/** Statuts pour lesquels le bien est diffusé, donc facturé. */
const BILLABLE: PropertyStatus[] = [
  PropertyStatus.ONLINE,
  PropertyStatus.VISITS_IN_PROGRESS,
];

/** Ligne de facturation : un bien du portefeuille, facturé ou non. */
export interface SubscriptionLine {
  reference: string;
  label: string;
  /** Le bien compte-t-il dans l'assiette du mois ? */
  billed: boolean;
  amountCents: number;
  /** Pourquoi il n'est pas facturé, quand il ne l'est pas. */
  statusLabel: string;
}

export interface SubscriptionInvoice {
  id: string;
  reference: string;
  /** Période facturée, au format « 09 / 2026 ». */
  period: string;
  propertyCount: number;
  amountCents: number;
  status: PaymentStatus;
  paidAt: string | null;
}

/**
 * Estimation de ce qu'un intermédiaire classique aurait coûté.
 *
 * Calculée sur le portefeuille réel, avec des taux de marché rangés dans
 * `platform_settings` : ce sont des ordres de grandeur, et ils doivent pouvoir
 * être corrigés sans redéploiement. Rien ici n'est un tarif Bail.
 */
export interface SubscriptionBenchmark {
  monthlyRentCents: number;
  lettingsPerYear: number;
  agencyYearlyCents: number;
  mandateYearlyCents: number;
  platformYearlyCents: number;
  agencyLettingFeeMonths: number;
  mandateRate: number;
}

export interface SubscriptionOverview {
  /** `null` tant que le propriétaire ne s'est pas abonné. */
  status: SubscriptionStatus | null;
  planLabel: string;
  /** Tarif mensuel par bien, issu du barème actif. */
  unitAmountCents: number | null;
  feeScheduleCode: string | null;
  /** Faux tant que l'avocat n'a pas figé le barème (docs/legal-context.md). */
  feeScheduleApproved: boolean;
  billableCount: number;
  monthlyTotalCents: number;
  nextChargeAt: string | null;
  cancelledAt: string | null;
  lines: SubscriptionLine[];
  invoices: SubscriptionInvoice[];
  benchmark: SubscriptionBenchmark | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expiry: string;
    holder: string;
    /** Vrai avec le driver simulé : aucune carte réelle n'existe. */
    simulated: boolean;
  } | null;
  /** Driver actif : `mock` tant qu'aucun compte Stripe n'est branché. */
  driver: string;
}

const STATUS_FROM_DRIVER: Record<DriverSubscription['status'], SubscriptionStatus> = {
  trialing: SubscriptionStatus.TRIALING,
  active: SubscriptionStatus.ACTIVE,
  past_due: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELLED,
};

/** Libellé des statuts non facturés, côté propriétaire. */
const NOT_BILLED_LABEL: Partial<Record<PropertyStatus, string>> = {
  [PropertyStatus.DRAFT]: 'brouillon, non publié',
  [PropertyStatus.PENDING_REVIEW]: 'au contrôle, pas encore diffusé',
  [PropertyStatus.RENTED]: 'loué, diffusion arrêtée',
  [PropertyStatus.ARCHIVED]: 'archivé',
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_DRIVER) private readonly driver: PaymentDriver,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------- Lectures

  /** Barème actif. Aucun montant n'est codé en dur (README, règle 3). */
  private activeFeeSchedule() {
    return this.prisma.feeSchedule.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private async readNumberSetting(key: string, fallback: number): Promise<number> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (!setting) return fallback;
    const value = typeof setting.value === 'string' ? Number(setting.value) : setting.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  /**
   * Nombre de biens diffusés — l'assiette de facturation.
   *
   * Un bien au contrôle n'est pas encore diffusé : le facturer reviendrait à
   * faire payer un service que le propriétaire n'a pas.
   */
  async billableCount(ownerId: string): Promise<number> {
    return this.prisma.property.count({
      where: { ownerId, status: { in: BILLABLE } },
    });
  }

  private async lines(ownerId: string, unitAmountCents: number): Promise<SubscriptionLine[]> {
    const properties = await this.prisma.property.findMany({
      where: { ownerId },
      orderBy: [{ status: 'asc' }, { reference: 'asc' }],
      // Le titre porte déjà le quartier (« 3 pièces, Sablon ») : le répéter
      // ferait « 3 pièces, Sablon — Sablon » sur chaque ligne.
      select: { reference: true, title: true, status: true },
    });

    return properties.map((property) => {
      const billed = BILLABLE.includes(property.status);
      return {
        reference: property.reference,
        label: property.title,
        billed,
        amountCents: billed ? unitAmountCents : 0,
        statusLabel: billed
          ? 'en ligne'
          : (NOT_BILLED_LABEL[property.status] ?? 'non diffusé'),
      };
    });
  }

  private async invoices(ownerId: string): Promise<SubscriptionInvoice[]> {
    const payments = await this.prisma.payment.findMany({
      where: { payerId: ownerId, type: PaymentType.OWNER_SUBSCRIPTION },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });

    return payments.map((payment) => {
      const period = payment.paidAt ?? payment.createdAt;
      const payload = payment.providerPayload as { propertyCount?: number } | null;
      return {
        id: payment.id,
        reference: payment.reference,
        period: `${String(period.getMonth() + 1).padStart(2, '0')} / ${period.getFullYear()}`,
        propertyCount: payload?.propertyCount ?? 0,
        amountCents: payment.amountCents,
        status: payment.status,
        paidAt: payment.paidAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * Comparatif « ce que vous auriez payé ailleurs ».
   *
   * Bâti sur le portefeuille réel, jamais sur des chiffres illustratifs : les
   * loyers viennent des biens diffusés, le nombre de mises en location des
   * douze derniers mois de publications. Les taux de marché sont des réglages.
   */
  private async benchmark(
    ownerId: string,
    monthlyTotalCents: number,
  ): Promise<SubscriptionBenchmark | null> {
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    const [billable, lettings, agencyLettingFeeMonths, mandateRate] = await Promise.all([
      this.prisma.property.findMany({
        where: { ownerId, status: { in: BILLABLE } },
        select: { rentCents: true, chargesCents: true },
      }),
      this.prisma.property.count({
        where: { ownerId, publishedAt: { gte: yearAgo } },
      }),
      this.readNumberSetting('owner.benchmark.agencyLettingFeeMonths', 1),
      this.readNumberSetting('owner.benchmark.mandateRate', 0.07),
    ]);

    // Sans bien diffusé, la comparaison n'a rien à comparer : mieux vaut ne
    // rien afficher qu'une colonne de zéros.
    if (billable.length === 0) return null;

    const monthlyRentCents = billable.reduce(
      (total, property) => total + property.rentCents + property.chargesCents,
      0,
    );
    const averageRentCents = Math.round(monthlyRentCents / billable.length);
    // Un portefeuille récemment repris peut n'avoir aucune publication datée :
    // on retombe alors sur le nombre de biens, l'hypothèse la plus prudente.
    const lettingsPerYear = lettings > 0 ? lettings : billable.length;

    return {
      monthlyRentCents,
      lettingsPerYear,
      agencyYearlyCents: Math.round(
        lettingsPerYear * averageRentCents * agencyLettingFeeMonths,
      ),
      mandateYearlyCents: Math.round(monthlyRentCents * 12 * mandateRate),
      platformYearlyCents: monthlyTotalCents * 12,
      agencyLettingFeeMonths,
      mandateRate,
    };
  }

  /** État complet de l'écran « Abonnement ». */
  async getOverview(ownerId: string): Promise<SubscriptionOverview> {
    const [subscription, feeSchedule] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { ownerId },
        orderBy: { createdAt: 'desc' },
      }),
      this.activeFeeSchedule(),
    ]);

    const unitAmountCents = feeSchedule?.ownerSubscriptionMonthlyCents ?? null;
    const lines = await this.lines(ownerId, unitAmountCents ?? 0);
    const billableCount = lines.filter((line) => line.billed).length;
    const monthlyTotalCents = (unitAmountCents ?? 0) * billableCount;

    const [invoices, benchmark] = await Promise.all([
      this.invoices(ownerId),
      this.benchmark(ownerId, monthlyTotalCents),
    ]);

    const driver = this.driver.name;

    return {
      status: subscription?.status ?? null,
      planLabel: 'Mensuel, sans engagement',
      unitAmountCents,
      feeScheduleCode: feeSchedule?.code ?? null,
      feeScheduleApproved: feeSchedule?.isLegallyApproved ?? false,
      billableCount,
      monthlyTotalCents,
      nextChargeAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
      cancelledAt: subscription?.cancelledAt?.toISOString() ?? null,
      lines,
      invoices,
      benchmark,
      paymentMethod:
        subscription === null
          ? null
          : {
              // Aucun compte Stripe n'est branché : la carte affichée est celle
              // du jeu d'essai, et le front l'annonce comme telle. Elle sera
              // remplacée par le moyen de paiement réel du client Stripe.
              brand: 'Visa',
              last4: '4242',
              expiry: '04/29',
              holder: 'Compte de test',
              simulated: driver === 'mock',
            },
      driver,
    };
  }

  // -------------------------------------------------------------- Écritures

  private async nextPaymentReference(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `FAC-${year}-`;
    const last = await tx.payment.findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const current = last ? parseInt(last.reference.slice(prefix.length), 10) : 0;
    return `${prefix}${String(current + 1).padStart(4, '0')}`;
  }

  /**
   * Souscrit l'abonnement du propriétaire connecté.
   *
   * L'abonnement existe au niveau du compte ; l'assiette est le nombre de biens
   * diffusés. S'abonner sans annonce en ligne est un cas normal — c'est même
   * l'ordre du parcours : on s'abonne, puis on publie.
   */
  async subscribe(ownerId: string): Promise<SubscriptionOverview> {
    const existing = await this.prisma.subscription.findFirst({
      where: { ownerId, status: { not: SubscriptionStatus.CANCELLED } },
    });
    if (existing) {
      throw new ConflictException('Un abonnement est déjà actif sur ce compte.');
    }

    const [owner, feeSchedule] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: ownerId } }),
      this.activeFeeSchedule(),
    ]);
    if (!owner) throw new NotFoundException('Compte introuvable.');
    if (!feeSchedule || feeSchedule.ownerSubscriptionMonthlyCents <= 0) {
      // Sans barème actif il n'existe aucun montant légitime à facturer, et on
      // n'en invente pas (README, règle 3).
      throw new BadRequestException(
        'Aucun barème actif ne définit le montant de l’abonnement. Contactez Bail.',
      );
    }

    const quantity = await this.billableCount(ownerId);

    // Un client peut déjà exister si un abonnement précédent a été résilié :
    // le recréer multiplierait les fiches côté prestataire.
    const previous = await this.prisma.subscription.findFirst({
      where: { ownerId, stripeCustomerId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { stripeCustomerId: true },
    });

    const customerId =
      previous?.stripeCustomerId ??
      (
        await this.driver.createCustomer({
          email: owner.email,
          name: `${owner.firstName} ${owner.lastName}`.trim(),
          userId: owner.id,
        })
      ).id;

    const created = await this.driver.createSubscription({
      customerId,
      unitAmountCents: feeSchedule.ownerSubscriptionMonthlyCents,
      quantity,
      currency: 'EUR',
      label: 'Bail — abonnement propriétaire, par bien diffusé',
    });

    await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: {
          ownerId,
          status: STATUS_FROM_DRIVER[created.status],
          monthlyAmountCents: feeSchedule.ownerSubscriptionMonthlyCents,
          feeScheduleId: feeSchedule.id,
          currentPeriodEnd: created.currentPeriodEnd,
          stripeSubscriptionId: created.id,
          stripeCustomerId: created.customerId,
        },
      });

      // Première échéance, en attente : le paiement n'est confirmé que par un
      // événement du prestataire, jamais par cet appel.
      await tx.payment.create({
        data: {
          reference: await this.nextPaymentReference(tx),
          type: PaymentType.OWNER_SUBSCRIPTION,
          status: PaymentStatus.PENDING,
          payerId: ownerId,
          subscriptionId: subscription.id,
          amountCents: feeSchedule.ownerSubscriptionMonthlyCents * quantity,
          ownerShareCents: feeSchedule.ownerSubscriptionMonthlyCents * quantity,
          feeScheduleId: feeSchedule.id,
          providerPayload: { propertyCount: quantity, driver: this.driver.name },
        },
      });
    });

    this.logger.log(`Abonnement souscrit pour ${ownerId} (${quantity} bien(s)).`);
    return this.getOverview(ownerId);
  }

  /**
   * Résilie. Effet à la fin du mois en cours : la période est déjà réglée,
   * couper immédiatement priverait le propriétaire de ce qu'il a payé.
   */
  async cancel(ownerId: string): Promise<SubscriptionOverview> {
    const subscription = await this.requireActive(ownerId);

    if (subscription.stripeSubscriptionId) {
      await this.driver.cancelSubscription(subscription.stripeSubscriptionId, true);
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelledAt: new Date() },
    });

    return this.getOverview(ownerId);
  }

  /** Annule une résiliation tant que la période en cours n'est pas écoulée. */
  async resume(ownerId: string): Promise<SubscriptionOverview> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { ownerId, status: { not: SubscriptionStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) throw new NotFoundException('Aucun abonnement à reprendre.');
    if (subscription.cancelledAt === null) {
      throw new ConflictException('Cet abonnement n’est pas résilié.');
    }

    if (subscription.stripeSubscriptionId) {
      // Repasser la quantité à jour remet `cancel_at_period_end` à faux côté
      // prestataire ; on en profite pour resynchroniser l'assiette.
      await this.driver.updateSubscriptionQuantity(
        subscription.stripeSubscriptionId,
        await this.billableCount(ownerId),
      );
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelledAt: null },
    });

    return this.getOverview(ownerId);
  }

  /**
   * Aligne l'assiette facturée sur le portefeuille.
   *
   * À appeler chaque fois qu'un bien entre ou sort de la diffusion — c'est-à-dire
   * depuis le back-office qui met en ligne ou retire une annonce. Sans cet
   * appel, un bien publié ne serait jamais facturé.
   */
  async syncQuantity(ownerId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { ownerId, status: { not: SubscriptionStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription?.stripeSubscriptionId) return;

    const quantity = await this.billableCount(ownerId);
    const updated = await this.driver.updateSubscriptionQuantity(
      subscription.stripeSubscriptionId,
      quantity,
    );

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: STATUS_FROM_DRIVER[updated.status],
        currentPeriodEnd: updated.currentPeriodEnd,
      },
    });
  }

  // --------------------------------------------------------------- Webhooks

  /**
   * Applique un événement du prestataire.
   *
   * Renvoie `false` pour un type non traité : le prestataire en émet des
   * dizaines, et répondre 200 sans rien faire vaut mieux que de les rejeter,
   * ce qui les ferait rejouer indéfiniment.
   *
   * L'appelant a déjà vérifié la signature ; ici on ne fait plus confiance
   * qu'à la structure, qu'on relit défensivement.
   */
  async handleWebhook(event: WebhookEvent): Promise<boolean> {
    switch (event.type) {
      case 'invoice.created':
        await this.onInvoiceCreated(event);
        return true;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await this.onInvoicePaid(event);
        return true;
      case 'invoice.payment_failed':
        await this.onInvoiceFailed(event);
        return true;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.onSubscriptionChanged(event);
        return true;
      default:
        this.logger.debug(`Événement ignoré : ${event.type}`);
        return false;
    }
  }

  /** Abonnement local visé par une facture, ou `null` s'il n'en existe pas. */
  private async subscriptionOfInvoice(invoice: InvoiceShape) {
    const providerId = readSubscriptionId(invoice);
    if (!providerId) return null;

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: providerId },
    });
    if (!subscription) {
      // Un abonnement inconnu n'est pas une erreur de notre côté : le compte
      // Stripe peut porter d'autres produits. On le journalise et on passe.
      this.logger.warn(`Facture reçue pour un abonnement inconnu : ${providerId}`);
    }
    return subscription;
  }

  /** Prépare l'échéance à venir, en attente de règlement. */
  private async onInvoiceCreated(event: WebhookEvent): Promise<void> {
    const invoice = event.data as InvoiceShape;
    const subscription = await this.subscriptionOfInvoice(invoice);
    if (!subscription) return;

    const invoiceId = readString(invoice.id);
    if (!invoiceId) return;

    const known = await this.prisma.payment.findFirst({
      where: { subscriptionId: subscription.id, stripePaymentIntentId: invoiceId },
    });
    if (known) return; // déjà enregistrée : l'événement est rejoué

    // La souscription a pu créer une échéance locale avant que le prestataire
    // n'émette sa facture. On l'adopte plutôt que d'en ouvrir une deuxième,
    // sinon le propriétaire verrait deux fois le même mois.
    const orphan = await this.prisma.payment.findFirst({
      where: {
        subscriptionId: subscription.id,
        status: PaymentStatus.PENDING,
        stripePaymentIntentId: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    const amountCents = readNumber(invoice.amount_due) ?? subscription.monthlyAmountCents;
    const propertyCount = readInvoiceQuantity(invoice);

    if (orphan) {
      await this.prisma.payment.update({
        where: { id: orphan.id },
        data: {
          stripePaymentIntentId: invoiceId,
          amountCents,
          ownerShareCents: amountCents,
          providerPayload: { propertyCount, eventId: event.id, driver: this.driver.name },
        },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          reference: await this.nextPaymentReference(tx),
          type: PaymentType.OWNER_SUBSCRIPTION,
          status: PaymentStatus.PENDING,
          payerId: subscription.ownerId,
          subscriptionId: subscription.id,
          amountCents,
          ownerShareCents: amountCents,
          feeScheduleId: subscription.feeScheduleId,
          stripePaymentIntentId: invoiceId,
          providerPayload: { propertyCount, eventId: event.id, driver: this.driver.name },
        },
      });
    });
  }

  private async onInvoicePaid(event: WebhookEvent): Promise<void> {
    const invoice = event.data as InvoiceShape;
    const subscription = await this.subscriptionOfInvoice(invoice);
    if (!subscription) return;

    const invoiceId = readString(invoice.id);
    const payment = await this.findInvoicePayment(subscription.id, invoiceId);
    if (payment && payment.status === PaymentStatus.PAID) return; // rejeu

    const amountCents =
      readNumber(invoice.amount_paid) ?? payment?.amountCents ?? subscription.monthlyAmountCents;

    if (payment) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          amountCents,
          ownerShareCents: amountCents,
          stripePaymentIntentId: invoiceId ?? payment.stripePaymentIntentId,
        },
      });
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: readDate(invoice.period_end) ?? subscription.currentPeriodEnd,
      },
    });
  }

  private async onInvoiceFailed(event: WebhookEvent): Promise<void> {
    const invoice = event.data as InvoiceShape;
    const subscription = await this.subscriptionOfInvoice(invoice);
    if (!subscription) return;

    const payment = await this.findInvoicePayment(subscription.id, readString(invoice.id));
    if (payment && payment.status !== PaymentStatus.FAILED) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          failureReason: readFailureReason(invoice) ?? 'Paiement refusé.',
        },
      });

      // Le propriétaire l'apprend de nous, pas seulement de sa banque : c'est
      // sa diffusion qui est en jeu à terme, et lui seul peut corriger son
      // moyen de paiement. Une seule fois par échéance.
      await this.mail.enqueue({
        template: EVENT.subscriptionPaymentFailed,
        userId: subscription.ownerId,
        subjectRef: payment.id,
      });
    }

    // L'abonnement n'est pas résilié pour autant : le prestataire relance, et
    // couper la diffusion au premier refus serait disproportionné.
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
  }

  private async onSubscriptionChanged(event: WebhookEvent): Promise<void> {
    const providerId = readString(event.data.id);
    if (!providerId) return;

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: providerId },
    });
    if (!subscription) return;

    const status = readString(event.data.status);
    const mapped =
      event.type === 'customer.subscription.deleted'
        ? SubscriptionStatus.CANCELLED
        : status === 'active'
          ? SubscriptionStatus.ACTIVE
          : status === 'trialing'
            ? SubscriptionStatus.TRIALING
            : status === 'past_due' || status === 'unpaid'
              ? SubscriptionStatus.PAST_DUE
              : SubscriptionStatus.CANCELLED;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: mapped,
        cancelledAt:
          mapped === SubscriptionStatus.CANCELLED
            ? (subscription.cancelledAt ?? new Date())
            : subscription.cancelledAt,
      },
    });
  }

  /**
   * Échéance locale correspondant à une facture du prestataire.
   *
   * L'identifiant de facture est cherché **en premier**, et seulement à défaut
   * l'échéance ouverte sans identifiant — celle que la souscription a créée
   * avant que le prestataire n'émette sa première facture. L'ordre compte :
   * l'inverse risquerait de marquer payé le mois suivant à la place du mois
   * réglé.
   */
  private async findInvoicePayment(subscriptionId: string, invoiceId: string | null) {
    if (invoiceId) {
      const exact = await this.prisma.payment.findFirst({
        where: { subscriptionId, stripePaymentIntentId: invoiceId },
      });
      if (exact) return exact;
    }

    return this.prisma.payment.findFirst({
      where: {
        subscriptionId,
        type: PaymentType.OWNER_SUBSCRIPTION,
        status: PaymentStatus.PENDING,
        stripePaymentIntentId: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async requireActive(ownerId: string): Promise<Subscription> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { ownerId, status: { not: SubscriptionStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) throw new NotFoundException('Aucun abonnement actif.');
    if (subscription.cancelledAt !== null) {
      throw new ConflictException('Cet abonnement est déjà résilié.');
    }
    return subscription;
  }
}
