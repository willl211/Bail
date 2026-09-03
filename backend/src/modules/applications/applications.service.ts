import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  GuarantorRequirement,
  Prisma,
  PropertyStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeTenantFees,
  type ActiveFeeSchedule,
  type TenantFees,
} from '../properties/property.mapper';
import { StorageService } from '../storage/storage.service';
import { TenantService, type TenantFileView } from '../tenant/tenant.service';
import { CreateApplicationDto } from './dto/create-application.dto';

/** Statuts pour lesquels un bien accepte encore des candidatures. */
const OPEN_STATUSES: PropertyStatus[] = [
  PropertyStatus.ONLINE,
  PropertyStatus.VISITS_IN_PROGRESS,
];

/** Champs du bien nécessaires à l'évaluation d'une candidature et à son aperçu. */
const CANDIDACY_SELECT = {
  id: true,
  reference: true,
  title: true,
  addressLine: true,
  city: true,
  surfaceM2: true,
  rooms: true,
  energyRating: true,
  rentCents: true,
  chargesCents: true,
  status: true,
  guarantorRequirement: true,
  acceptedContractTypes: true,
  minMonthlyIncomeCents: true,
  district: { select: { name: true } },
  photos: { orderBy: { position: 'asc' as const }, take: 1 },
  _count: { select: { applications: true } },
} satisfies Prisma.PropertySelect;

type CandidacyProperty = Prisma.PropertyGetPayload<{ select: typeof CANDIDACY_SELECT }>;

export interface CandidacyPropertySummary {
  reference: string;
  title: string;
  district: string;
  addressLine: string;
  city: string;
  surfaceM2: number;
  rooms: number;
  energyRating: string | null;
  totalRentCents: number;
  photoLabel: string;
  photoUrl: string | null;
  applicationCount: number;
}

/** Dossier tel que résumé sur l'écran de candidature — un sous-ensemble de `TenantFileView`. */
export interface CandidacyFileSummary {
  holderName: string;
  contractType: string | null;
  netMonthlyIncomeCents: number | null;
  incomeVerified: boolean;
  guarantor: { label: string; verified: boolean } | null;
}

export interface CandidacyPreview {
  property: CandidacyPropertySummary;
  fees: TenantFees | null;
  /** Loyer charges comprises de **ce** bien rapporté aux revenus du dossier. */
  effortRate: number | null;
  file: CandidacyFileSummary;
  /** Empêchent d'envoyer la candidature. */
  blockers: string[];
  /** N'empêchent rien, mais valent d'être signalées avant l'envoi. */
  warnings: string[];
  alreadyApplied: boolean;
  applicationStatus: ApplicationStatus | null;
  /** « 31 h » — délai moyen de réponse affiché ailleurs sur le site. */
  averageResponseDelay: string | null;
}

export interface TenantApplicationSummary {
  id: string;
  propertyReference: string;
  propertyTitle: string;
  district: string;
  totalRentCents: number;
  submittedAt: string;
  status: ApplicationStatus;
  /** Étape lisible, telle qu'affichée dans la colonne « Étape » du suivi. */
  stepLabel: string;
}

/** Étape du parcours associée à chaque statut, pour le suivi des candidatures. */
const STEP_LABEL: Record<ApplicationStatus, string> = {
  SUBMITTED: 'Étude du dossier',
  READ: 'Étude du dossier',
  SHORTLISTED: 'Dossier retenu',
  VISIT_SCHEDULED: 'Visite planifiée',
  ACCEPTED: 'Acceptée',
  REJECTED: 'Non retenue',
  WITHDRAWN: 'Retirée',
  EXPIRED: 'Expirée',
};

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly storage: StorageService,
  ) {}

  private async propertyForCandidacy(reference: string): Promise<CandidacyProperty> {
    const property = await this.prisma.property.findFirst({
      where: { reference, status: { in: OPEN_STATUSES } },
      select: CANDIDACY_SELECT,
    });
    // 404 plutôt que « ce bien n'accepte plus de candidature » : un bien loué
    // ou retiré n'a pas à confirmer qu'il a existé sous cette référence à qui
    // ne le voit déjà plus sur la fiche annonce.
    if (!property) {
      throw new NotFoundException('Ce bien n’est plus disponible à la candidature.');
    }
    return property;
  }

  private activeFeeSchedule(): Promise<ActiveFeeSchedule | null> {
    return this.prisma.feeSchedule.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
      select: {
        code: true,
        tenantVisitFeeCentsPerSqm: true,
        tenantInventoryFeeCentsPerSqm: true,
        isLegallyApproved: true,
      },
    });
  }

  private async averageResponseDelay(): Promise<string | null> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: 'market.metz.averageResponseDelay' },
    });
    return typeof setting?.value === 'string' ? setting.value : null;
  }

  /**
   * Ce qui bloque ou tempère une candidature.
   *
   * Trois motifs bloquent, et rien d'autre : la loi (revenus insuffisants) ne
   * ferme jamais la porte à elle seule, c'est au propriétaire d'en décider en
   * regardant le garant et le taux d'effort — exactement ce que la fiche lui
   * transmet. Bloquer sur autre chose que ces trois motifs déciderait à sa
   * place.
   */
  private evaluate(
    property: CandidacyProperty,
    file: TenantFileView,
  ): { blockers: string[]; warnings: string[] } {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (file.submittedAt === null) {
      blockers.push('Transmettez d’abord votre dossier depuis « Mon dossier ».');
    } else if (file.status === 'REJECTED') {
      blockers.push('Votre dossier a été refusé par Bail. Contactez le support pour candidater.');
    }

    if (property.acceptedContractTypes.length > 0) {
      // Deux causes très différentes derrière le même refus : ne pas avoir
      // renseigné sa situation, ou en avoir une que le bien écarte. Dire « ce
      // bien n'accepte pas votre situation » à qui n'en a déclaré aucune
      // l'enverrait chercher un problème qui n'existe pas.
      if (file.contractType === null) {
        blockers.push('Renseignez votre situation professionnelle dans votre dossier.');
      } else if (!property.acceptedContractTypes.includes(file.contractType)) {
        blockers.push('Ce bien n’accepte pas la situation professionnelle de votre dossier.');
      }
    }

    if (property.guarantorRequirement === GuarantorRequirement.REQUIRED) {
      if (file.guarantor === null) {
        blockers.push('Ce bien exige un garant : déclarez-en un dans votre dossier.');
      } else if (file.groups.guarantor !== 'VERIFIED') {
        warnings.push('Les pièces de votre garant ne sont pas encore toutes vérifiées.');
      }
    } else if (
      property.guarantorRequirement === GuarantorRequirement.OPTIONAL &&
      file.guarantor !== null &&
      file.groups.guarantor !== 'VERIFIED'
    ) {
      warnings.push('Les pièces de votre garant ne sont pas encore toutes vérifiées.');
    }

    if (
      property.minMonthlyIncomeCents !== null &&
      file.netMonthlyIncomeCents !== null &&
      file.netMonthlyIncomeCents < property.minMonthlyIncomeCents
    ) {
      warnings.push('Vos revenus sont sous le seuil habituellement demandé pour ce bien.');
    }

    if (file.submittedAt !== null && !file.incomeVerified) {
      warnings.push('Vos revenus ne sont pas encore vérifiés par Bail.');
    }

    return { blockers, warnings };
  }

  /**
   * Score de compatibilité 0-100, persisté sur la candidature.
   *
   * Première heuristique, transparente et documentée plutôt que savante :
   * 40 points pour le taux d'effort, 30 pour l'état du dossier, 20 pour la
   * situation professionnelle, 10 pour le garant. Elle sert à trier, pas à
   * décider — la décision reste au propriétaire, sur les mêmes données qu'il
   * voit dans le détail (`OwnerApplicationsService`).
   */
  private scoreOf(property: CandidacyProperty, file: TenantFileView): number {
    let score = 0;
    const totalRentCents = property.rentCents + property.chargesCents;

    if (file.netMonthlyIncomeCents) {
      const ratio = totalRentCents / file.netMonthlyIncomeCents;
      // Effort nul → 40 points ; effort de 50 % ou plus → 0.
      score += Math.max(0, Math.round(40 * (1 - ratio / 0.5)));
    }

    if (file.status === 'VERIFIED') score += 30;
    else if (file.submittedAt !== null) score += 15;

    const acceptedContract =
      property.acceptedContractTypes.length === 0 ||
      (file.contractType !== null && property.acceptedContractTypes.includes(file.contractType));
    if (acceptedContract) score += 20;

    if (property.guarantorRequirement === GuarantorRequirement.NONE) score += 10;
    else if (file.guarantor !== null && file.groups.guarantor === 'VERIFIED') score += 10;
    else if (file.guarantor !== null) score += 5;

    return Math.min(100, Math.max(0, score));
  }

  private toPropertySummary(property: CandidacyProperty): CandidacyPropertySummary {
    const photo = property.photos[0] ?? null;
    return {
      reference: property.reference,
      title: property.title,
      district: property.district.name,
      addressLine: property.addressLine,
      city: property.city,
      surfaceM2: property.surfaceM2,
      rooms: property.rooms,
      energyRating: property.energyRating,
      totalRentCents: property.rentCents + property.chargesCents,
      photoLabel: photo?.caption ?? 'photo',
      photoUrl: photo ? this.storage.publicUrl('public', photo.storageKey) : null,
      applicationCount: property._count.applications,
    };
  }

  private toFileSummary(file: TenantFileView): CandidacyFileSummary {
    const guarantor = file.guarantor;
    return {
      holderName: file.holderName,
      contractType: file.contractType,
      netMonthlyIncomeCents: file.netMonthlyIncomeCents,
      incomeVerified: file.incomeVerified,
      guarantor:
        guarantor === null
          ? null
          : {
              label:
                guarantor.kind === 'ORGANISATION'
                  ? (guarantor.organisationName ?? 'Organisme de cautionnement')
                  : `${guarantor.firstName ?? ''} ${guarantor.lastName ?? ''}`.trim(),
              verified: file.groups.guarantor === 'VERIFIED',
            },
    };
  }

  /** Aperçu affiché avant l'envoi — et après, pour confirmer ce qui a été transmis. */
  async preview(tenantId: string, reference: string): Promise<CandidacyPreview> {
    const [property, file, feeSchedule, existing, averageResponseDelay] = await Promise.all([
      this.propertyForCandidacy(reference),
      this.tenant.getFile(tenantId),
      this.activeFeeSchedule(),
      this.prisma.application.findFirst({
        where: { tenant: { id: tenantId }, property: { reference } },
        select: { status: true },
      }),
      this.averageResponseDelay(),
    ]);

    const { blockers, warnings } = this.evaluate(property, file);
    const totalRentCents = property.rentCents + property.chargesCents;

    return {
      property: this.toPropertySummary(property),
      fees: computeTenantFees(property, feeSchedule),
      effortRate: file.netMonthlyIncomeCents
        ? totalRentCents / file.netMonthlyIncomeCents
        : null,
      file: this.toFileSummary(file),
      blockers,
      warnings,
      alreadyApplied: existing !== null,
      applicationStatus: existing?.status ?? null,
      averageResponseDelay,
    };
  }

  /**
   * Envoie la candidature.
   *
   * Revérifie les blocages côté serveur — l'aperçu peut avoir été chargé avant
   * une modification du dossier ou du bien, et le bouton du front n'est pas un
   * contrôle d'accès.
   */
  async apply(
    tenantId: string,
    reference: string,
    dto: CreateApplicationDto,
  ): Promise<CandidacyPreview> {
    // Une seule lecture du dossier : deux appels concurrents en ouvriraient
    // deux sur un compte qui n'en a pas encore.
    const [property, { view: file, id: fileId }] = await Promise.all([
      this.propertyForCandidacy(reference),
      this.tenant.getFileWithId(tenantId),
    ]);

    const { blockers } = this.evaluate(property, file);
    if (blockers.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Votre dossier ne répond pas encore aux critères de ce bien.',
        blockers,
      });
    }

    const totalRentCents = property.rentCents + property.chargesCents;
    const incomeRatio = file.netMonthlyIncomeCents
      ? totalRentCents / file.netMonthlyIncomeCents
      : null;

    try {
      await this.prisma.application.create({
        data: {
          propertyId: property.id,
          tenantId,
          tenantFileId: fileId,
          incomeRatio,
          compatibilityScore: this.scoreOf(property, file),
          message: dto.message ?? null,
        },
      });
    } catch (error) {
      // Contrainte `@@unique([propertyId, tenantId])` : on candidate une fois
      // par bien, pas davantage à chaque clic malheureux.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Vous avez déjà candidaté sur ce bien.');
      }
      throw error;
    }

    return this.preview(tenantId, reference);
  }

  /** Suivi de mes candidatures, tous biens confondus. */
  async listMine(tenantId: string): Promise<TenantApplicationSummary[]> {
    const applications = await this.prisma.application.findMany({
      where: { tenantId },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        property: {
          select: {
            reference: true,
            title: true,
            rentCents: true,
            chargesCents: true,
            district: { select: { name: true } },
          },
        },
      },
    });

    return applications.map((application) => ({
      id: application.id,
      propertyReference: application.property.reference,
      propertyTitle: application.property.title,
      district: application.property.district.name,
      totalRentCents: application.property.rentCents + application.property.chargesCents,
      submittedAt: application.submittedAt.toISOString(),
      status: application.status,
      stepLabel: STEP_LABEL[application.status],
    }));
  }
}
