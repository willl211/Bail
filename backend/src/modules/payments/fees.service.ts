import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FundsStatus,
  LeaseStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_DRIVER, type PaymentDriver } from './payment.driver';

/**
 * Honoraires à la charge du locataire — écran 7 du build-order.
 *
 * Deux postes, et deux seulement, parce que la loi les plafonne séparément
 * (décret n° 2014-890) : d'un côté la visite, la constitution du dossier et la
 * rédaction du bail ; de l'autre l'état des lieux d'entrée. Les montants
 * viennent du barème en base, jamais du code (README, règle 3).
 */

/**
 * Repère de marché pour le comparatif, en centimes par m².
 *
 * Un seul, et adossé au plafond légal : c'est la seule borne vérifiable. Un
 * repère « agence en ligne » a été écarté — aucune donnée ne le fonde, et un
 * chiffre inventé dans un comparatif qui nous met en valeur n'a pas sa place.
 */
const BENCHMARK_KEY = 'tenant.benchmark.agencyFeeCentsPerSqm';

/**
 * Plafond légal des honoraires locataire en zone non tendue, en centimes par m².
 *
 * 8 €/m² pour visite, dossier et rédaction, 3 €/m² pour l'état des lieux
 * (décret n° 2014-890). Plafonds légaux, donc en dur : les mettre en base
 * laisserait croire qu'on peut les relever.
 */
const LEGAL_CAP_CENTS_PER_SQM = { drafting: 800, inventory: 300 };

export interface FeeLine {
  key: string;
  label: string;
  detail: string;
  amountCents: number;
  /** Plafond légal applicable à ce poste, pour le même bien. */
  legalCapCents: number;
}

export interface FeeBenchmark {
  agencyCents: number;
  platformCents: number;
  legalCapCents: number;
}

export interface FeesView {
  leaseReference: string;
  leaseStatus: LeaseStatus;
  propertyReference: string;
  propertyTitle: string;
  surfaceM2: number;
  lines: FeeLine[];
  totalCents: number;
  /** Part propriétaire. Nulle : la promesse du produit est un abonnement. */
  ownerShareCents: number;
  centsPerSqm: number;
  feeScheduleCode: string | null;
  /** Faux tant que l'avocat n'a pas figé le barème. Bloque le paiement. */
  feeScheduleApproved: boolean;
  benchmark: FeeBenchmark | null;
  /** À prévoir à l'entrée, hors honoraires. */
  depositCents: number;
  firstRentCents: number;
  moveInTotalCents: number;
  moveInDate: string;
  payment: {
    reference: string;
    status: PaymentStatus;
    amountCents: number;
    paidAt: string | null;
  } | null;
  /** Ce qui empêche de régler. Vide = le paiement peut partir. */
  blockers: string[];
  paymentDriver: string;
}

@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_DRIVER) private readonly payment: PaymentDriver,
  ) {}

  private async readSetting(key: string, fallback: number): Promise<number> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (!setting) return fallback;
    const value = typeof setting.value === 'string' ? Number(setting.value) : setting.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  /** Bail lisible par son locataire. */
  private async leaseOf(reference: string, tenantId: string) {
    const lease = await this.prisma.lease.findFirst({
      where: { reference, tenantId },
      include: { property: true },
    });
    // 404 et non 403 sur le bail d'autrui : « interdit » confirmerait qu'il existe.
    if (!lease) throw new NotFoundException('Bail introuvable.');
    return lease;
  }

  async getFees(reference: string, tenantId: string): Promise<FeesView> {
    const lease = await this.leaseOf(reference, tenantId);

    const [feeSchedule, agencyPerSqm, payment] = await Promise.all([
      this.prisma.feeSchedule.findFirst({
        where: { isActive: true },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.readSetting(BENCHMARK_KEY, 1100),
      this.prisma.payment.findFirst({
        where: { leaseId: lease.id, type: PaymentType.TENANT_FEE },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const surface = lease.property.surfaceM2;
    const draftingCents = feeSchedule
      ? Math.round(surface * feeSchedule.tenantVisitFeeCentsPerSqm)
      : 0;
    const inventoryCents = feeSchedule
      ? Math.round(surface * feeSchedule.tenantInventoryFeeCentsPerSqm)
      : 0;
    const totalCents = draftingCents + inventoryCents;

    const blockers: string[] = [];
    if (!feeSchedule) {
      blockers.push('Aucun barème actif : rien ne peut être facturé.');
    } else if (!feeSchedule.isLegallyApproved) {
      blockers.push(
        'Le barème d’honoraires n’est pas validé juridiquement. Aucun montant ne peut être encaissé tant que l’avocat ne l’a pas figé.',
      );
    }
    if (lease.status !== LeaseStatus.SIGNED) {
      blockers.push(
        'Les honoraires se règlent après la signature du bail par les deux parties.',
      );
    }
    if (this.payment.name === 'mock') {
      blockers.push(
        'Aucun prestataire de paiement n’est branché : le règlement ne peut pas aboutir.',
      );
    }

    const moveInDate = lease.startDate;
    const firstRentCents = lease.rentCents + lease.chargesCents;

    return {
      leaseReference: lease.reference,
      leaseStatus: lease.status,
      propertyReference: lease.property.reference,
      propertyTitle: lease.property.title,
      surfaceM2: surface,
      lines: [
        {
          key: 'drafting',
          label: 'Visite, constitution du dossier et rédaction du bail',
          detail: feeSchedule
            ? `${surface} m² × ${(feeSchedule.tenantVisitFeeCentsPerSqm / 100).toLocaleString('fr-FR')} €/m²`
            : '—',
          amountCents: draftingCents,
          legalCapCents: Math.round(surface * LEGAL_CAP_CENTS_PER_SQM.drafting),
        },
        {
          key: 'inventory',
          label: 'État des lieux d’entrée',
          detail: feeSchedule
            ? `${surface} m² × ${(feeSchedule.tenantInventoryFeeCentsPerSqm / 100).toLocaleString('fr-FR')} €/m²`
            : '—',
          amountCents: inventoryCents,
          legalCapCents: Math.round(surface * LEGAL_CAP_CENTS_PER_SQM.inventory),
        },
      ],
      totalCents,
      // Zéro, et ce n'est pas un oubli : la promesse du produit est « un
      // abonnement, pas une commission ». Le propriétaire ne paie rien à la
      // transaction.
      ownerShareCents: feeSchedule
        ? Math.round(surface * feeSchedule.ownerFeeCentsPerSqm)
        : 0,
      centsPerSqm: feeSchedule
        ? feeSchedule.tenantVisitFeeCentsPerSqm + feeSchedule.tenantInventoryFeeCentsPerSqm
        : 0,
      feeScheduleCode: feeSchedule?.code ?? null,
      feeScheduleApproved: feeSchedule?.isLegallyApproved ?? false,
      benchmark:
        totalCents === 0
          ? null
          : {
              agencyCents: Math.round(surface * agencyPerSqm),
              platformCents: totalCents,
              legalCapCents: Math.round(
                surface *
                  (LEGAL_CAP_CENTS_PER_SQM.drafting + LEGAL_CAP_CENTS_PER_SQM.inventory),
              ),
            },
      depositCents: lease.depositCents,
      firstRentCents,
      moveInTotalCents: totalCents + lease.depositCents + firstRentCents,
      moveInDate: moveInDate.toISOString(),
      payment: payment
        ? {
            reference: payment.reference,
            status: payment.status,
            amountCents: payment.amountCents,
            paidAt: payment.paidAt?.toISOString() ?? null,
          }
        : null,
      blockers,
      paymentDriver: this.payment.name,
    };
  }

  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `HON-${new Date().getFullYear()}-`;
    const last = await tx.payment.findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const current = last ? parseInt(last.reference.slice(prefix.length), 10) : 0;
    return `${prefix}${String(current + 1).padStart(4, '0')}`;
  }

  /**
   * Ouvre le règlement des honoraires.
   *
   * Ne prélève rien : crée l'intention de paiement chez le prestataire et
   * renvoie de quoi la confirmer. **Les coordonnées bancaires ne transitent
   * jamais par Bail** — c'est le prestataire qui les collecte, ce qui nous
   * tient hors du périmètre PCI-DSS. La maquette montrait un formulaire de
   * carte ; le reproduire aurait été une faute.
   */
  async startPayment(
    reference: string,
    tenantId: string,
  ): Promise<{ clientSecret: string | null; view: FeesView }> {
    const view = await this.getFees(reference, tenantId);

    if (view.blockers.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Ces honoraires ne peuvent pas être réglés pour l’instant.',
        blockers: view.blockers,
      });
    }
    if (view.payment?.status === PaymentStatus.PAID) {
      throw new ConflictException('Ces honoraires sont déjà réglés.');
    }

    const lease = await this.leaseOf(reference, tenantId);
    const feeSchedule = await this.prisma.feeSchedule.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });

    const intent = await this.payment.createPaymentIntent({
      amountCents: view.totalCents,
      currency: 'EUR',
      description: `Bail — honoraires locataire ${lease.reference}`,
      metadata: { leaseReference: lease.reference },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          reference: await this.nextReference(tx),
          type: PaymentType.TENANT_FEE,
          status: PaymentStatus.PENDING,
          payerId: tenantId,
          propertyId: lease.propertyId,
          leaseId: lease.id,
          applicationId: lease.applicationId,
          amountCents: view.totalCents,
          tenantShareCents: view.totalCents,
          ownerShareCents: 0,
          feeScheduleId: feeSchedule?.id ?? null,
          method: PaymentMethod.CARD,
          // Les honoraires sont encaissés pour compte propre : ils ne
          // transitent pas vers le propriétaire, contrairement au dépôt de
          // garantie et aux loyers (docs/legal-context.md).
          fundsStatus: FundsStatus.NOT_APPLICABLE,
          stripePaymentIntentId: intent.id,
        },
      });
    });

    this.logger.log(`Honoraires ouverts pour ${lease.reference} : ${intent.id}`);
    return {
      clientSecret: intent.clientSecret,
      view: await this.getFees(reference, tenantId),
    };
  }
}
