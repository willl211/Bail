import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  DocumentStatus,
  DocumentType,
  PreauthorizationStatus,
  PropertyStatus,
  VisitStatus,
  type EmploymentContractType,
  type GuarantorKind,
  type TenantFileStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Vignette par bien : combien de candidatures, et sur quel loyer. */
export interface ApplicationTile {
  reference: string;
  title: string;
  district: string;
  status: PropertyStatus;
  /** `false` pour un bien non diffusé : il ne peut rien recevoir. */
  open: boolean;
  applicationCount: number;
  totalRentCents: number;
  rooms: number;
  furnished: boolean;
  /** Ce qui empêche la diffusion, quand le bien n'est pas en ligne. */
  hint: string | null;
  /** Sert de premier événement au journal du bien. */
  publishedAt: string | null;
}

/**
 * Candidature vue par le propriétaire.
 *
 * Ce que le propriétaire voit s'arrête au résultat des vérifications : le
 * revenu vérifié, le taux d'effort, l'état du garant. Les **pièces**
 * (bulletins de salaire, pièce d'identité, avis d'imposition) restent chez
 * Bail — elles ne sont ni exposées ici, ni téléchargeables. C'est la promesse
 * faite au locataire, et elle vaut mieux que les habitudes du marché.
 */
export interface OwnerApplication {
  id: string;
  propertyReference: string;
  propertyTitle: string;
  tenantName: string;
  tenantInitials: string;
  fileReference: string;
  fileStatus: TenantFileStatus;
  netMonthlyIncomeCents: number | null;
  contractType: EmploymentContractType | null;
  employerName: string | null;
  /**
   * Vraie quand une pièce d'identité du dossier est vérifiée.
   *
   * Déduite des pièces, pas d'un drapeau posé à la main : c'est le contrôle
   * réel qui doit répondre, sinon la mention ne vaut rien.
   */
  identityVerified: boolean;
  /** Mot du candidat au propriétaire. */
  message: string | null;
  /** Loyer charges comprises rapporté aux revenus nets vérifiés. */
  effortRate: number | null;
  guarantorLabel: string | null;
  verifiedDocumentCount: number;
  documentCount: number;
  status: ApplicationStatus;
  submittedAt: string;
}

export interface OwnerApplicationsView {
  newCount: number;
  underReviewCount: number;
  visitsScheduledCount: number;
  /** Délai moyen de première lecture, en heures. `null` sans historique. */
  averageResponseHours: number | null;
  tiles: ApplicationTile[];
  applications: OwnerApplication[];
}

/** Candidatures que le propriétaire n'a pas encore ouvertes. */
const NEW: ApplicationStatus[] = [ApplicationStatus.SUBMITTED];

/**
 * Candidatures déjà tranchées : elles ne se re-décident pas depuis cet écran.
 *
 * `ACCEPTED` en fait partie — revenir dessus après avoir lancé la génération du
 * bail est une opération d'une autre nature, qui relèvera du back-office.
 */
const DECIDED: ApplicationStatus[] = [
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
  ApplicationStatus.EXPIRED,
];

/** Candidatures en cours d'examen : lues, sans décision. */
const UNDER_REVIEW: ApplicationStatus[] = [
  ApplicationStatus.READ,
  ApplicationStatus.SHORTLISTED,
];

const initialsOf = (firstName: string, lastName: string) =>
  `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

/** Pourquoi un bien ne reçoit pas de candidature. */
const CLOSED_HINT: Partial<Record<PropertyStatus, string>> = {
  [PropertyStatus.DRAFT]: 'brouillon, non publié',
  [PropertyStatus.PENDING_REVIEW]: 'au contrôle Bail',
  [PropertyStatus.RENTED]: 'loué',
  [PropertyStatus.ARCHIVED]: 'archivé',
};

@Injectable()
export class OwnerApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<OwnerApplicationsView> {
    const [properties, applications] = await Promise.all([
      this.prisma.property.findMany({
        where: { ownerId },
        orderBy: [{ status: 'asc' }, { reference: 'asc' }],
        select: {
          reference: true,
          title: true,
          status: true,
          rentCents: true,
          chargesCents: true,
          rooms: true,
          furnished: true,
          publishedAt: true,
          district: { select: { name: true } },
          _count: { select: { applications: true } },
        },
      }),
      this.prisma.application.findMany({
        where: { property: { ownerId } },
        // Le taux d'effort le plus bas d'abord : c'est le tri de la maquette,
        // et c'est celui qui met en avant les dossiers les plus solides.
        orderBy: [{ incomeRatio: 'asc' }, { submittedAt: 'desc' }],
        select: {
          id: true,
          status: true,
          submittedAt: true,
          readAt: true,
          incomeRatio: true,
          message: true,
          property: { select: { reference: true, title: true } },
          tenant: { select: { firstName: true, lastName: true } },
          tenantFile: {
            select: {
              reference: true,
              status: true,
              netMonthlyIncomeCents: true,
              contractType: true,
              employerName: true,
              guarantors: {
                select: {
                  kind: true,
                  organisationName: true,
                  netMonthlyIncomeCents: true,
                },
                take: 1,
              },
              documents: { select: { type: true, status: true } },
            },
          },
        },
      }),
    ]);

    const visitsScheduledCount = applications.filter(
      (application) => application.status === ApplicationStatus.VISIT_SCHEDULED,
    ).length;

    return {
      newCount: applications.filter((a) => NEW.includes(a.status)).length,
      underReviewCount: applications.filter((a) => UNDER_REVIEW.includes(a.status)).length,
      visitsScheduledCount,
      averageResponseHours: averageResponseHours(applications),
      tiles: properties.map((property) => ({
        reference: property.reference,
        title: property.title,
        district: property.district.name,
        status: property.status,
        open:
          property.status === PropertyStatus.ONLINE ||
          property.status === PropertyStatus.VISITS_IN_PROGRESS,
        applicationCount: property._count.applications,
        totalRentCents: property.rentCents + property.chargesCents,
        rooms: property.rooms,
        furnished: property.furnished,
        hint: CLOSED_HINT[property.status] ?? null,
        publishedAt: property.publishedAt?.toISOString() ?? null,
      })),
      applications: applications.map((application) => {
        const file = application.tenantFile;
        const guarantor = file.guarantors[0] ?? null;

        return {
          id: application.id,
          propertyReference: application.property.reference,
          propertyTitle: application.property.title,
          tenantName: `${application.tenant.firstName} ${application.tenant.lastName}`,
          tenantInitials: initialsOf(
            application.tenant.firstName,
            application.tenant.lastName,
          ),
          fileReference: file.reference,
          fileStatus: file.status,
          netMonthlyIncomeCents: file.netMonthlyIncomeCents,
          contractType: file.contractType,
          employerName: file.employerName,
          identityVerified: file.documents.some(
            (document) =>
              (document.type === DocumentType.ID_CARD ||
                document.type === DocumentType.PASSPORT) &&
              document.status === DocumentStatus.VERIFIED,
          ),
          message: application.message,
          effortRate: application.incomeRatio,
          guarantorLabel: guarantorLabel(guarantor),
          verifiedDocumentCount: file.documents.filter(
            (document) => document.status === DocumentStatus.VERIFIED,
          ).length,
          documentCount: file.documents.length,
          status: application.status,
          submittedAt: application.submittedAt.toISOString(),
        };
      }),
    };
  }

  /**
   * Candidature du portefeuille du propriétaire connecté.
   *
   * 404 et non 403 sur celle d'un autre : « interdit » confirmerait qu'elle
   * existe.
   */
  private async ownedOrFail(ownerId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, property: { ownerId } },
      select: { id: true, status: true, readAt: true },
    });
    if (!application) throw new NotFoundException('Candidature introuvable.');
    return application;
  }

  /**
   * Retient un candidat et lui ouvre la prise de rendez-vous.
   *
   * Ne fige rien : plusieurs candidats peuvent être retenus en même temps, et
   * plusieurs peuvent visiter. C'est l'acceptation finale — écran 6, avec la
   * génération du bail — qui écartera les autres.
   */
  async shortlist(ownerId: string, applicationId: string): Promise<OwnerApplicationsView> {
    const application = await this.ownedOrFail(ownerId, applicationId);

    if (DECIDED.includes(application.status)) {
      throw new ConflictException('Cette candidature est déjà tranchée.');
    }
    // Une visite déjà planifiée l'est : repasser « retenue » effacerait le
    // rendez-vous de l'écran du locataire sans l'annuler pour autant.
    if (application.status === ApplicationStatus.VISIT_SCHEDULED) {
      throw new ConflictException('Une visite est déjà planifiée pour ce candidat.');
    }

    await this.prisma.application.update({
      where: { id: application.id },
      data: {
        status: ApplicationStatus.SHORTLISTED,
        // Retenir un dossier, c'est l'avoir lu : sans ça le délai de réponse
        // resterait vide alors que le propriétaire a bel et bien répondu.
        readAt: application.readAt ?? new Date(),
      },
    });

    return this.list(ownerId);
  }

  /** Écarte un candidat. Le motif lui sera visible : il a droit à une raison. */
  async reject(
    ownerId: string,
    applicationId: string,
    reason?: string,
  ): Promise<OwnerApplicationsView> {
    const application = await this.ownedOrFail(ownerId, applicationId);

    if (DECIDED.includes(application.status)) {
      throw new ConflictException('Cette candidature est déjà tranchée.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: application.id },
        data: {
          status: ApplicationStatus.REJECTED,
          rejectionReason: reason ?? null,
          readAt: application.readAt ?? new Date(),
          decidedAt: new Date(),
        },
      });

      // Un rendez-vous à venir sur une candidature écartée n'a plus d'objet :
      // il est annulé et son créneau rendu au propriétaire.
      const visits = await tx.visit.findMany({
        where: {
          applicationId: application.id,
          status: { in: [VisitStatus.REQUESTED, VisitStatus.PENDING_CHECKS, VisitStatus.CONFIRMED] },
        },
        select: { id: true },
      });

      if (visits.length > 0) {
        const ids = visits.map((visit) => visit.id);
        await tx.visit.updateMany({
          where: { id: { in: ids } },
          data: {
            status: VisitStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: 'Candidature écartée par le propriétaire',
            preauthorizationStatus: PreauthorizationStatus.RELEASED,
          },
        });
        await tx.visitSlot.updateMany({
          where: { visitId: { in: ids } },
          data: { visitId: null },
        });
      }
    });

    return this.list(ownerId);
  }
}

/**
 * Garant, en une ligne.
 *
 * Un organisme de cautionnement (Visale, caution bancaire) se nomme ; il n'a
 * pas de revenus, et en afficher un — fût-il nul — n'aurait aucun sens. Une
 * personne physique, elle, ne vaut que par ses revenus.
 */
function guarantorLabel(
  guarantor: {
    kind: GuarantorKind;
    organisationName: string | null;
    netMonthlyIncomeCents: number | null;
  } | null,
): string | null {
  if (guarantor === null) return null;

  if (guarantor.kind === 'ORGANISATION') {
    return guarantor.organisationName ?? 'Organisme de cautionnement';
  }

  if (guarantor.netMonthlyIncomeCents === null) return 'Personne physique';
  return `Personne physique · ${Math.round(
    guarantor.netMonthlyIncomeCents / 100,
  ).toLocaleString('fr-FR')} € nets`;
}

/**
 * Délai moyen entre l'envoi d'une candidature et sa première lecture.
 *
 * C'est le chiffre que l'accueil promet aux locataires : il doit être mesuré,
 * pas paramétré. Tant qu'aucune candidature n'a été lue, il vaut `null` et
 * l'écran affiche un tiret — mieux qu'un zéro qui se lirait « réponse
 * instantanée ».
 */
function averageResponseHours(
  applications: { submittedAt: Date; readAt: Date | null }[],
): number | null {
  const read = applications.filter(
    (application): application is { submittedAt: Date; readAt: Date } =>
      application.readAt !== null,
  );
  if (read.length === 0) return null;

  const total = read.reduce(
    (sum, application) =>
      sum + (application.readAt.getTime() - application.submittedAt.getTime()),
    0,
  );
  return Math.round(total / read.length / 3_600_000);
}
