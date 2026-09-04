import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentStatus,
  DocumentType,
  LeaseStatus,
  PaymentStatus,
  PropertyStatus,
  TenantFileStatus,
  UserRole,
  VisitStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { propertyChecks } from '../owner/property.checks';
import { SubscriptionService } from '../payments/subscription.service';
import { EVENT } from '../mail/event.templates';
import { MailService } from '../mail/mail.service';
import { SavedService } from '../saved/saved.service';
import { requiredTypes } from '../tenant/tenant.slots';

export interface BackofficeSummary {
  filesToReview: number;
  propertiesToReview: number;
  activeLeases: number;
  /** Fonds encaissés pour le compte des propriétaires, pas encore reversés. */
  pendingPayoutCents: number;
  onlinePropertyCount: number;
  activeFileCount: number;
  verifiedFileCount: number;
  /** Délai moyen de contrôle d'une pièce, en heures. `null` sans historique. */
  averageReviewHours: number | null;
}

export interface AdminFileRow {
  reference: string;
  holderName: string;
  initials: string;
  status: TenantFileStatus;
  verifiedCount: number;
  requiredCount: number;
  /** Pièces en attente d'une décision humaine. */
  pendingDocuments: {
    id: string;
    type: DocumentType;
    label: string;
    note: string | null;
    uploadedAt: string;
  }[];
  /**
   * Pièces requises qui ne sont pas encore vérifiées — absentes du dossier ou
   * refusées. Distinctes de `pendingDocuments`, qui n'appelle qu'une décision :
   * sans cette liste, l'agent découvrirait ce qui manque en essuyant un refus.
   */
  missingLabels: string[];
  identityVerified: boolean;
  /** Écart entre revenus déclarés et pièces, quand il est mesurable. */
  incomeFlag: string | null;
  submittedAt: string | null;
}

export interface AdminPropertyRow {
  reference: string;
  title: string;
  ownerName: string;
  district: string;
  status: PropertyStatus;
  totalRentCents: number;
  surfaceM2: number;
  /** Locataires ayant mis ce bien de côté. Agrégat, jamais nominatif. */
  savedCount: number;
  blockers: string[];
  warnings: string[];
  submittedAt: string | null;
}

export interface AdminLeaseRow {
  reference: string;
  propertyReference: string;
  tenantName: string;
  status: LeaseStatus;
  signedCount: number;
  feeStatus: PaymentStatus | null;
  feeAmountCents: number | null;
  fundsStatus: string | null;
  rentCents: number;
}

export interface AdminVisitRow {
  id: string;
  propertyReference: string;
  tenantName: string;
  type: string;
  status: VisitStatus;
  scheduledAt: string;
  agentName: string | null;
}

export interface JournalEntry {
  at: string;
  tone: 'ok' | 'pending' | 'reject' | 'neutral';
  title: string;
  note: string;
}

export interface ProviderRow {
  key: string;
  label: string;
  driver: string;
  /** Vrai quand un prestataire réel est branché. */
  live: boolean;
}

/** Libellés des pièces, pour le registre. */
const DOCUMENT_LABELS: Partial<Record<DocumentType, string>> = {
  ID_CARD: 'Pièce d’identité',
  PASSPORT: 'Passeport',
  PAYSLIP: 'Bulletin de salaire',
  EMPLOYMENT_CONTRACT: 'Contrat de travail',
  TAX_NOTICE: 'Avis d’imposition',
  PROOF_OF_ADDRESS: 'Justificatif de domicile',
  STUDENT_CARD: 'Certificat de scolarité',
  GUARANTOR_ID: 'Pièce d’identité du garant',
  GUARANTOR_INCOME: 'Revenus du garant',
  OTHER: 'Autre pièce',
};

@Injectable()
export class BackofficeService {
  private readonly logger = new Logger(BackofficeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly subscriptions: SubscriptionService,
    private readonly mail: MailService,
    private readonly saved: SavedService,
  ) {}

  // ---------------------------------------------------------------- Registre

  async summary(): Promise<BackofficeSummary> {
    const [
      filesToReview,
      propertiesToReview,
      activeLeases,
      pendingPayout,
      onlinePropertyCount,
      activeFileCount,
      verifiedFileCount,
      reviewedDocuments,
    ] = await Promise.all([
      this.prisma.tenantFile.count({
        where: { status: { in: [TenantFileStatus.SUBMITTED, TenantFileStatus.UNDER_REVIEW] } },
      }),
      this.prisma.property.count({ where: { status: PropertyStatus.PENDING_REVIEW } }),
      this.prisma.lease.count({
        where: { status: { in: [LeaseStatus.SENT_FOR_SIGNATURE, LeaseStatus.PARTIALLY_SIGNED, LeaseStatus.SIGNED] } },
      }),
      this.prisma.payment.aggregate({
        where: { fundsStatus: { in: ['HELD_BY_PLATFORM', 'PAYOUT_PENDING'] } },
        _sum: { amountCents: true },
      }),
      this.prisma.property.count({
        where: { status: { in: [PropertyStatus.ONLINE, PropertyStatus.VISITS_IN_PROGRESS] } },
      }),
      this.prisma.tenantFile.count(),
      this.prisma.tenantFile.count({ where: { status: TenantFileStatus.VERIFIED } }),
      this.prisma.tenantDocument.findMany({
        where: { verifiedAt: { not: null } },
        select: { createdAt: true, verifiedAt: true },
        take: 200,
        orderBy: { verifiedAt: 'desc' },
      }),
    ]);

    // Mesuré, pas paramétré : le délai affiché doit venir des contrôles
    // réellement effectués, sinon c'est une promesse déguisée en chiffre.
    //
    // Les durées négatives sont écartées plutôt que moyennées : une pièce
    // « vérifiée avant d'être déposée » est une anomalie de données, et la
    // laisser entrer dans le calcul produirait un délai négatif — un chiffre
    // faux affiché comme une mesure.
    const reviewDurations = reviewedDocuments
      .map((document) => (document.verifiedAt as Date).getTime() - document.createdAt.getTime())
      .filter((duration) => duration >= 0);

    const averageReviewHours =
      reviewDurations.length === 0
        ? null
        : Math.round(
            reviewDurations.reduce((total, duration) => total + duration, 0) /
              reviewDurations.length /
              3_600_000,
          );

    return {
      filesToReview,
      propertiesToReview,
      activeLeases,
      pendingPayoutCents: pendingPayout._sum.amountCents ?? 0,
      onlinePropertyCount,
      activeFileCount,
      verifiedFileCount,
      averageReviewHours,
    };
  }

  /** Prestataires réglementés et driver actif pour chacun. */
  providers(): ProviderRow[] {
    const rows: { key: string; label: string; path: string }[] = [
      { key: 'kyc', label: 'KYC — identité et pièces', path: 'integrations.kyc.driver' },
      { key: 'signature', label: 'Signature — DocuSign', path: 'integrations.signature.driver' },
      { key: 'payment', label: 'Paiement — Stripe', path: 'integrations.payment.driver' },
      { key: 'video', label: 'Visio', path: 'integrations.video.driver' },
    ];

    return rows.map((row) => {
      const driver = this.config.get<string>(row.path, 'mock');
      return { ...row, driver, live: driver !== 'mock' };
    });
  }

  // ---------------------------------------------------------------- Dossiers

  async listFiles(): Promise<AdminFileRow[]> {
    const files = await this.prisma.tenantFile.findMany({
      where: { status: { not: TenantFileStatus.DRAFT } },
      orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
      include: {
        tenant: { select: { firstName: true, lastName: true } },
        documents: true,
        guarantors: { select: { kind: true } },
      },
    });

    return files.map((file) => {
      const required = requiredTypes(file.contractType, file.guarantors[0]?.kind ?? null);
      const isVerified = (type: DocumentType) =>
        file.documents.some(
          (document) => document.type === type && document.status === DocumentStatus.VERIFIED,
        );
      const verifiedCount = required.filter(isVerified).length;

      return {
        reference: file.reference,
        holderName: `${file.tenant.firstName} ${file.tenant.lastName}`,
        initials:
          `${file.tenant.firstName.charAt(0)}${file.tenant.lastName.charAt(0)}`.toUpperCase(),
        status: file.status,
        verifiedCount,
        requiredCount: required.length,
        pendingDocuments: file.documents
          .filter(
            (document) =>
              document.status === DocumentStatus.PENDING ||
              document.status === DocumentStatus.PROCESSING,
          )
          .map((document) => ({
            id: document.id,
            type: document.type,
            label: DOCUMENT_LABELS[document.type] ?? document.type,
            note: document.verificationNote,
            uploadedAt: document.createdAt.toISOString(),
          })),
        missingLabels: required
          .filter((type) => !isVerified(type))
          .map((type) => DOCUMENT_LABELS[type] ?? type),
        identityVerified: file.documents.some(
          (document) =>
            (document.type === DocumentType.ID_CARD ||
              document.type === DocumentType.PASSPORT) &&
            document.status === DocumentStatus.VERIFIED,
        ),
        // Le rapprochement revenus déclarés / bulletins demanderait de lire les
        // pièces : hors de portée sans prestataire KYC. On ne prétend pas le
        // faire — un écart inventé serait pire qu'aucun signalement.
        incomeFlag: null,
        submittedAt: file.submittedAt?.toISOString() ?? null,
      };
    });
  }

  /** Tranche sur une pièce déposée. */
  async decideDocument(
    documentId: string,
    decision: 'VERIFY' | 'REJECT',
    reason?: string,
  ): Promise<AdminFileRow[]> {
    const document = await this.prisma.tenantDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        status: true,
        tenantFileId: true,
        tenantFile: { select: { tenantId: true } },
      },
    });
    if (!document) throw new NotFoundException('Pièce introuvable.');

    if (document.status === DocumentStatus.VERIFIED && decision === 'VERIFY') {
      throw new ConflictException('Cette pièce est déjà vérifiée.');
    }
    if (decision === 'REJECT' && !reason?.trim()) {
      // Un refus sans motif renvoie le locataire à un mur : il ne saurait pas
      // quoi corriger.
      throw new BadRequestException('Un refus doit être motivé.');
    }

    await this.prisma.tenantDocument.update({
      where: { id: document.id },
      data:
        decision === 'VERIFY'
          ? {
              status: DocumentStatus.VERIFIED,
              verifiedAt: new Date(),
              verificationNote: 'Contrôle manuel par un agent Bail',
              rejectionReason: null,
            }
          : {
              status: DocumentStatus.REJECTED,
              verifiedAt: null,
              rejectionReason: reason?.trim(),
              verificationNote: null,
            },
    });

    if (decision === 'REJECT') {
      // La clé de dédoublonnage porte l'instant de la décision : une même pièce
      // peut être refusée, corrigée, puis refusée à nouveau, et le locataire
      // doit l'apprendre les deux fois.
      await this.mail.enqueue({
        template: EVENT.documentRejected,
        userId: document.tenantFile.tenantId,
        subjectRef: document.id,
        dedupeKey: `${EVENT.documentRejected}:${document.id}:${Date.now()}`,
      });
    }

    // Un dossier dont une pièce vient d'être refusée n'est plus « vérifié » :
    // le laisser tel quel le ferait passer pour bon auprès des propriétaires.
    if (decision === 'REJECT') {
      await this.prisma.tenantFile.updateMany({
        where: { id: document.tenantFileId, status: TenantFileStatus.VERIFIED },
        data: { status: TenantFileStatus.INCOMPLETE, verifiedAt: null },
      });
    }

    return this.listFiles();
  }

  /**
   * Clôt le contrôle d'un dossier.
   *
   * Refuse de le marquer vérifié s'il reste une pièce requise non vérifiée :
   * un dossier estampillé « vérifié » circule ensuite auprès des propriétaires,
   * il ne doit pas mentir.
   */
  async decideFile(
    reference: string,
    decision: 'VERIFY' | 'REJECT',
    reason?: string,
  ): Promise<AdminFileRow[]> {
    const file = await this.prisma.tenantFile.findUnique({
      where: { reference },
      include: { documents: true, guarantors: { select: { kind: true } } },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');
    const notify = (template: string) =>
      this.mail.enqueue({
        template: template as (typeof EVENT)[keyof typeof EVENT],
        userId: file.tenantId,
        subjectRef: file.id,
        // Un dossier peut être vérifié, redevenir incomplet après le refus
        // d'une pièce, puis vérifié à nouveau : chaque passage se notifie.
        dedupeKey: `${template}:${file.id}:${Date.now()}`,
      });

    if (decision === 'VERIFY') {
      const required = requiredTypes(file.contractType, file.guarantors[0]?.kind ?? null);
      const missing = required.filter(
        (type) =>
          !file.documents.some(
            (document) => document.type === type && document.status === DocumentStatus.VERIFIED,
          ),
      );
      if (missing.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Ce dossier ne peut pas être marqué vérifié.',
          blockers: missing.map(
            (type) => `${DOCUMENT_LABELS[type] ?? type} — en attente de vérification`,
          ),
        });
      }

      await this.prisma.tenantFile.update({
        where: { id: file.id },
        data: { status: TenantFileStatus.VERIFIED, verifiedAt: new Date() },
      });
      await notify(EVENT.fileVerified);
    } else {
      if (!reason?.trim()) throw new BadRequestException('Un refus doit être motivé.');
      await this.prisma.tenantFile.update({
        where: { id: file.id },
        data: { status: TenantFileStatus.REJECTED, verifiedAt: null },
      });
      await notify(EVENT.fileRejected);
    }

    return this.listFiles();
  }

  // ------------------------------------------------------------------ Biens

  async listProperties(): Promise<AdminPropertyRow[]> {
    const properties = await this.prisma.property.findMany({
      where: { status: { not: PropertyStatus.DRAFT } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'asc' }],
      include: {
        owner: { select: { firstName: true, lastName: true } },
        district: { select: { name: true } },
        photos: { select: { id: true } },
        documents: { select: { type: true } },
      },
    });

    const saved = await this.saved.countsByProperty(properties.map((p) => p.id));

    return properties.map((property) => ({
      reference: property.reference,
      title: property.title,
      ownerName: `${property.owner.firstName} ${property.owner.lastName}`,
      district: property.district.name,
      status: property.status,
      totalRentCents: property.rentCents + property.chargesCents,
      surfaceM2: property.surfaceM2,
      savedCount: saved.get(property.id) ?? 0,
      ...propertyChecks(property),
      submittedAt: property.updatedAt.toISOString(),
    }));
  }

  /**
   * Met une annonce en ligne, ou la renvoie à son propriétaire.
   *
   * La publication rejoue **les mêmes contrôles** que ceux affichés au
   * propriétaire : un agent pressé ne doit pas pouvoir publier un bien sans
   * DPE en cliquant plus vite que la règle.
   */
  async decideProperty(
    reference: string,
    decision: 'PUBLISH' | 'REJECT',
    reason?: string,
  ): Promise<AdminPropertyRow[]> {
    const property = await this.prisma.property.findUnique({
      where: { reference },
      include: {
        photos: { select: { id: true } },
        documents: { select: { type: true } },
      },
    });
    if (!property) throw new NotFoundException('Bien introuvable.');

    if (property.status !== PropertyStatus.PENDING_REVIEW) {
      throw new ConflictException('Ce bien n’est pas en attente de contrôle.');
    }

    if (decision === 'PUBLISH') {
      const { blockers } = propertyChecks(property);
      if (blockers.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Ce bien ne remplit pas les conditions de publication.',
          blockers,
        });
      }

      await this.prisma.property.update({
        where: { id: property.id },
        data: { status: PropertyStatus.ONLINE, publishedAt: new Date(), reviewNote: null },
      });

      // Le bien entre dans l'assiette facturée : sans cet appel, un bien
      // publié ne serait jamais facturé au propriétaire.
      await this.subscriptions.syncQuantity(property.ownerId);
      await this.mail.enqueue({
        template: EVENT.propertyPublished,
        userId: property.ownerId,
        subjectRef: property.id,
        dedupeKey: `${EVENT.propertyPublished}:${property.id}:${Date.now()}`,
      });

      // Un bien en ligne ne se modifie pas : il repasse en brouillon, est
      // corrigé, puis revient au contrôle. C'est donc ici, au moment où il
      // redevient visible, qu'une baisse de loyer devient réelle pour ceux qui
      // l'avaient mis de côté.
      await this.saved.notifyPriceDrop(property.id);

      this.logger.log(`Annonce ${reference} publiée.`);
    } else {
      if (!reason?.trim()) throw new BadRequestException('Un refus doit être motivé.');
      // Retour en brouillon plutôt qu'un statut « refusé » : le propriétaire
      // doit pouvoir corriger et resoumettre, pas repartir de zéro.
      //
      // Le motif est **stocké**, pas seulement journalisé : le back-office
      // annonce au contrôleur qu'il est « transmis au propriétaire ». Sans ce
      // champ, la phrase serait fausse.
      await this.prisma.property.update({
        where: { id: property.id },
        data: { status: PropertyStatus.DRAFT, reviewNote: reason.trim() },
      });
      await this.mail.enqueue({
        template: EVENT.propertyReturned,
        userId: property.ownerId,
        subjectRef: property.id,
        dedupeKey: `${EVENT.propertyReturned}:${property.id}:${Date.now()}`,
      });
      this.logger.log(`Annonce ${reference} renvoyée au propriétaire.`);
    }

    return this.listProperties();
  }

  // ------------------------------------------------------- Baux et paiements

  async listLeases(): Promise<AdminLeaseRow[]> {
    const leases = await this.prisma.lease.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        property: { select: { reference: true } },
        tenant: { select: { firstName: true, lastName: true } },
        payments: { where: { type: 'TENANT_FEE' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return leases.map((lease) => {
      const events = (lease.signatureEvents ?? []) as { type?: string }[];
      const fee = lease.payments[0] ?? null;

      return {
        reference: lease.reference,
        propertyReference: lease.property.reference,
        tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        status: lease.status,
        signedCount: events.filter((event) => event.type === 'signed').length,
        feeStatus: fee?.status ?? null,
        feeAmountCents: fee?.amountCents ?? null,
        fundsStatus: fee?.fundsStatus ?? null,
        rentCents: lease.rentCents,
      };
    });
  }

  // ---------------------------------------------------------------- Visites

  async listVisits(): Promise<AdminVisitRow[]> {
    const visits = await this.prisma.visit.findMany({
      where: {
        status: { in: [VisitStatus.REQUESTED, VisitStatus.PENDING_CHECKS, VisitStatus.CONFIRMED] },
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        property: { select: { reference: true } },
        tenant: { select: { firstName: true, lastName: true } },
        agent: { select: { firstName: true, lastName: true } },
      },
    });

    return visits.map((visit) => ({
      id: visit.id,
      propertyReference: visit.property.reference,
      tenantName: `${visit.tenant.firstName} ${visit.tenant.lastName}`,
      type: visit.type,
      status: visit.status,
      scheduledAt: visit.scheduledAt.toISOString(),
      agentName: visit.agent
        ? `${visit.agent.firstName} ${visit.agent.lastName.charAt(0)}.`
        : null,
    }));
  }

  /** Affecte un agent à une visite — sans quoi personne n'ouvre le logement. */
  async assignVisit(visitId: string, agentId: string): Promise<AdminVisitRow[]> {
    const [visit, agent] = await Promise.all([
      this.prisma.visit.findUnique({ where: { id: visitId }, select: { id: true, status: true } }),
      this.prisma.user.findFirst({
        where: { id: agentId, role: UserRole.AGENT },
        select: { id: true },
      }),
    ]);
    if (!visit) throw new NotFoundException('Visite introuvable.');
    if (!agent) throw new BadRequestException('Cet agent n’existe pas.');
    if (visit.status === VisitStatus.CANCELLED || visit.status === VisitStatus.COMPLETED) {
      throw new ConflictException('Cette visite est close.');
    }

    await this.prisma.visit.update({ where: { id: visit.id }, data: { agentId: agent.id } });
    return this.listVisits();
  }

  /** Agents disponibles pour une affectation. */
  agents() {
    return this.prisma.user.findMany({
      where: { role: UserRole.AGENT, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { lastName: 'asc' },
    });
  }

  // ---------------------------------------------------------------- Journal

  /**
   * Journal d'activité.
   *
   * Reconstitué à partir d'horodatages réels — publications, candidatures,
   * pièces contrôlées, visites, baux. Rien n'est inventé pour remplir la page :
   * un journal qui mentirait sur ce qui s'est passé n'a aucune valeur d'audit.
   */
  async journal(limit = 40): Promise<JournalEntry[]> {
    const [properties, applications, documents, visits, leases] = await Promise.all([
      this.prisma.property.findMany({
        where: { publishedAt: { not: null } },
        orderBy: { publishedAt: 'desc' },
        take: 15,
        select: { reference: true, publishedAt: true },
      }),
      this.prisma.application.findMany({
        orderBy: { submittedAt: 'desc' },
        take: 15,
        include: {
          property: { select: { reference: true } },
          tenant: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.tenantDocument.findMany({
        where: { OR: [{ verifiedAt: { not: null } }, { status: DocumentStatus.REJECTED }] },
        orderBy: { updatedAt: 'desc' },
        take: 15,
        include: { tenantFile: { select: { reference: true } } },
      }),
      this.prisma.visit.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 15,
        include: { property: { select: { reference: true } } },
      }),
      this.prisma.lease.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 15,
        select: { reference: true, status: true, updatedAt: true, createdAt: true },
      }),
    ]);

    const entries: JournalEntry[] = [
      ...properties.map((property) => ({
        at: (property.publishedAt as Date).toISOString(),
        tone: 'ok' as const,
        title: `${property.reference} publié`,
        note: 'Contrôle validé',
      })),
      ...applications.map((application) => ({
        at: application.submittedAt.toISOString(),
        tone: 'neutral' as const,
        title: `Candidature sur ${application.property.reference}`,
        note: `${application.tenant.firstName} ${application.tenant.lastName}`,
      })),
      ...documents.map((document) => ({
        at: (document.verifiedAt ?? document.updatedAt).toISOString(),
        tone: (document.status === DocumentStatus.REJECTED ? 'reject' : 'ok') as
          | 'reject'
          | 'ok',
        // Formulation sans accord : les intitulés de pièces sont tantôt
        // masculins (« Bulletin de salaire »), tantôt féminins (« Pièce
        // d'identité »), tantôt pluriels (« Revenus du garant »).
        title: `${document.tenantFile.reference} — ${DOCUMENT_LABELS[document.type] ?? document.type} · ${
          document.status === DocumentStatus.REJECTED ? 'refus' : 'contrôle validé'
        }`,
        note: document.rejectionReason ?? document.verificationNote ?? 'Contrôle',
      })),
      ...visits.map((visit) => ({
        at: visit.updatedAt.toISOString(),
        tone: (visit.status === VisitStatus.CANCELLED ? 'reject' : 'pending') as
          | 'reject'
          | 'pending',
        title: `Visite ${visit.status === VisitStatus.CANCELLED ? 'annulée' : 'planifiée'} · ${visit.property.reference}`,
        note:
          visit.recordingExpiresAt !== null
            ? `Enregistrement purgé le ${visit.recordingExpiresAt.toLocaleDateString('fr-FR')}`
            : visit.type === 'VIDEO'
              ? 'Visio'
              : 'Accompagnée',
      })),
      ...leases.map((lease) => ({
        at: lease.updatedAt.toISOString(),
        tone: (lease.status === LeaseStatus.SIGNED ? 'ok' : 'pending') as 'ok' | 'pending',
        title: `${lease.reference} — ${lease.status === LeaseStatus.SIGNED ? 'signé' : 'ouvert'}`,
        note: 'Bail',
      })),
    ];

    return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
}
