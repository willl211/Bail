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
import { publicationChecks, diagnosticStatus } from '../owner/property.checks';
import {
  advancePropertyRevision,
  recordPropertyEvent,
  propertyEventView,
  PROPERTY_CHANGED,
} from '../owner/property-review';
import type { DiagnosticDecisionDto } from './dto/decision.dto';
import { SubscriptionService } from '../payments/subscription.service';
import { EVENT } from '../mail/event.templates';
import { MailService } from '../mail/mail.service';
import { SavedService } from '../saved/saved.service';
import {
  requiredDocumentChecks,
  verificationBlockers,
  verificationSnapshot,
} from '../tenant/tenant-file.policy';
import {
  advanceFileRevision,
  fileEventView,
  recordFileEvent,
  FILE_CHANGED,
  type FileActor,
} from '../tenant/tenant-file.revision';
import { StorageService } from '../storage/storage.service';
import { signatureProgress } from '../lease/lease-signature.policy';
import type { EmploymentContractType, GuarantorKind } from '@prisma/client';

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
  revision: number;
  profile: {
    contractType: EmploymentContractType | null;
    employerName: string | null;
    netMonthlyIncomeCents: number | null;
    inProbationPeriod: boolean | null;
    guarantor: { kind: GuarantorKind; name: string; netMonthlyIncomeCents: number | null } | null;
  };
  documents: {
    id: string;
    type: DocumentType;
    label: string;
    status: DocumentStatus;
    fileName: string | null;
    hasFile: boolean;
    note: string | null;
    uploadedAt: string;
  }[];
  history: JournalEntry[];
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
  revision: number;
  addressLine: string;
  energyRating: string | null;
  reviewNote: string | null;
  documents: {
    id: string;
    type: string;
    status: DocumentStatus;
    fileName: string | null;
    hasFile: boolean;
    issuedAt: string | null;
    expiresAt: string | null;
    note: string | null;
    uploadedAt: string;
  }[];
  history: JournalEntry[];
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
    private readonly storage: StorageService,
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
        where: {
          status: {
            in: [LeaseStatus.SENT_FOR_SIGNATURE, LeaseStatus.PARTIALLY_SIGNED, LeaseStatus.SIGNED],
          },
        },
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
        guarantors: true,
        events: { orderBy: { revision: 'desc' }, take: 20 },
      },
    });
    return files.map((file) => {
      const checks = requiredDocumentChecks(file);
      return {
        reference: file.reference,
        revision: file.revision,
        holderName: [file.tenant.firstName, file.tenant.lastName].join(' '),
        initials: (file.tenant.firstName.charAt(0) + file.tenant.lastName.charAt(0)).toUpperCase(),
        status: file.status,
        verifiedCount: checks.filter((slot) => slot.status === DocumentStatus.VERIFIED).length,
        requiredCount: checks.length,
        profile: {
          contractType: file.contractType,
          employerName: file.employerName,
          netMonthlyIncomeCents: file.netMonthlyIncomeCents,
          inProbationPeriod: file.inProbationPeriod,
          guarantor: file.guarantors[0]
            ? {
                kind: file.guarantors[0].kind,
                name:
                  file.guarantors[0].organisationName ??
                  [file.guarantors[0].firstName, file.guarantors[0].lastName]
                    .filter(Boolean)
                    .join(' '),
                netMonthlyIncomeCents: file.guarantors[0].netMonthlyIncomeCents,
              }
            : null,
        },
        documents: file.documents.map((document) => ({
          id: document.id,
          type: document.type,
          label: DOCUMENT_LABELS[document.type] ?? document.type,
          status: document.status,
          fileName: document.fileName,
          hasFile: document.storageKey !== null,
          note: document.rejectionReason ?? document.verificationNote,
          uploadedAt: document.createdAt.toISOString(),
        })),
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
        missingLabels: verificationBlockers(file),
        identityVerified:
          checks.find((slot) => slot.type === DocumentType.ID_CARD)?.status ===
          DocumentStatus.VERIFIED,
        incomeFlag: null,
        submittedAt: file.submittedAt?.toISOString() ?? null,
        history: file.events.map(fileEventView),
      };
    });
  }

  /** Consultation privée par un agent ; aucune route propriétaire n'est élargie. */
  async readTenantDocument(documentId: string, actor: FileActor, revision?: number) {
    const document = await this.prisma.tenantDocument.findUnique({
      where: { id: documentId },
      include: { tenantFile: true },
    });
    if (!document?.storageKey) throw new NotFoundException('Pièce introuvable.');
    if (revision !== undefined && document.tenantFile.revision !== revision)
      throw new ConflictException(FILE_CHANGED);
    const stream = await this.storage.read('private', document.storageKey);
    this.logger.log('Consultation de pièce ' + document.id + ' par agent ' + actor.id);
    return {
      stream,
      mimeType: document.mimeType ?? 'application/octet-stream',
      fileName: document.fileName ?? 'document',
    };
  }

  async decideDocument(
    documentId: string,
    decision: 'VERIFY' | 'REJECT',
    expectedRevision: number,
    actor: FileActor,
    reason?: string,
  ): Promise<AdminFileRow[]> {
    const document = await this.prisma.tenantDocument.findUnique({
      where: { id: documentId },
      include: { tenantFile: true },
    });
    if (!document) throw new NotFoundException('Pièce introuvable.');
    const file = document.tenantFile;
    if (file.revision !== expectedRevision) throw new ConflictException(FILE_CHANGED);
    if (file.status === TenantFileStatus.DRAFT)
      throw new ConflictException('Ce dossier n’a pas encore été transmis.');
    if (document.status === DocumentStatus.VERIFIED && decision === 'VERIFY')
      throw new ConflictException('Cette pièce est déjà vérifiée.');
    if (decision === 'REJECT' && !reason?.trim())
      throw new BadRequestException('Un refus doit être motivé.');

    if (decision === 'VERIFY') await this.assertReadable(document.storageKey);

    const event = await this.prisma.$transaction(async (tx) => {
      const revision = await advanceFileRevision(
        tx,
        file,
        decision === 'REJECT' && file.status === TenantFileStatus.VERIFIED
          ? { status: TenantFileStatus.INCOMPLETE }
          : {},
      );
      await tx.tenantDocument.update({
        where: { id: document.id },
        data:
          decision === 'VERIFY'
            ? {
                status: DocumentStatus.VERIFIED,
                verifiedAt: new Date(),
                verificationNote: 'Contrôle manuel par un agent whoma',
                rejectionReason: null,
              }
            : {
                status: DocumentStatus.REJECTED,
                verifiedAt: null,
                rejectionReason: reason!.trim(),
                verificationNote: null,
              },
      });
      return recordFileEvent(tx, file.id, revision, actor, {
        action: decision === 'VERIFY' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED',
        title: decision === 'VERIFY' ? 'Pièce validée' : 'Pièce refusée',
        note:
          (DOCUMENT_LABELS[document.type] ?? document.type) +
          (reason?.trim() ? ' · ' + reason.trim() : ''),
        snapshot: {
          documentId: document.id,
          type: document.type,
          fileName: document.fileName,
          reviewedRevision: expectedRevision,
        },
      });
    });
    if (decision === 'REJECT')
      await this.mail.enqueue({
        template: EVENT.documentRejected,
        userId: file.tenantId,
        subjectRef: document.id,
        dedupeKey: EVENT.documentRejected + ':' + event.id,
      });
    return this.listFiles();
  }

  async decideFile(
    reference: string,
    decision: 'VERIFY' | 'REJECT',
    expectedRevision: number,
    actor: FileActor,
    reason?: string,
  ): Promise<AdminFileRow[]> {
    const file = await this.prisma.tenantFile.findUnique({
      where: { reference },
      include: { documents: true, guarantors: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');
    if (file.revision !== expectedRevision) throw new ConflictException(FILE_CHANGED);
    if (file.status === TenantFileStatus.DRAFT || file.submittedAt === null)
      throw new ConflictException('Ce dossier n’a pas encore été transmis.');
    if (decision === 'VERIFY' && file.status === TenantFileStatus.VERIFIED)
      throw new ConflictException('Ce dossier est déjà vérifié.');
    if (decision === 'REJECT' && !reason?.trim())
      throw new BadRequestException('Un refus doit être motivé.');
    const blockers = verificationBlockers(file);
    if (decision === 'VERIFY' && blockers.length)
      throw new BadRequestException({
        statusCode: 400,
        message: 'Ce dossier ne peut pas être marqué vérifié.',
        blockers,
      });

    const event = await this.prisma.$transaction(async (tx) => {
      const revision = await advanceFileRevision(tx, file, {
        status: decision === 'VERIFY' ? TenantFileStatus.VERIFIED : TenantFileStatus.REJECTED,
        verifiedAt: decision === 'VERIFY' ? new Date() : null,
        verifiedRevision: decision === 'VERIFY' ? file.revision + 1 : null,
      });
      return recordFileEvent(tx, file.id, revision, actor, {
        action: decision === 'VERIFY' ? 'FILE_VERIFIED' : 'FILE_REJECTED',
        title: decision === 'VERIFY' ? 'Dossier validé' : 'Dossier refusé',
        note:
          reason?.trim() ||
          'Les informations et toutes les pièces requises de cette version ont été contrôlées.',
        snapshot: { reviewedRevision: expectedRevision, ...verificationSnapshot(file) },
      });
    });
    const template = decision === 'VERIFY' ? EVENT.fileVerified : EVENT.fileRejected;
    await this.mail.enqueue({
      template,
      userId: file.tenantId,
      subjectRef: file.id,
      dedupeKey: template + ':' + event.id,
    });
    return this.listFiles();
  }

  // ------------------------------------------------------------------ Biens

  private async assertReadable(key: string | null) {
    if (!key) throw new BadRequestException('Fichier indisponible : demandez un nouveau dépôt.');
    try {
      const stream = await this.storage.read('private', key);
      let size = 0;
      for await (const chunk of stream) size += (chunk as Buffer).length;
      if (size === 0) throw new Error('Empty document');
    } catch {
      throw new BadRequestException('Fichier indisponible : demandez un nouveau dépôt.');
    }
  }

  async readPropertyDocument(documentId: string, actor: FileActor, revision?: number) {
    const document = await this.prisma.propertyDocument.findUnique({
      where: { id: documentId },
      include: { property: true },
    });
    if (
      !document ||
      (document.property.status === PropertyStatus.DRAFT && !document.property.reviewNote)
    )
      throw new NotFoundException('Diagnostic introuvable ou non transmis au contrôle.');
    if (revision !== undefined && document.property.reviewRevision !== revision)
      throw new ConflictException(PROPERTY_CHANGED);
    const stream = await this.storage.read('private', document.storageKey);
    this.logger.log('Consultation du diagnostic ' + document.id + ' par agent ' + actor.id);
    return {
      stream,
      mimeType: document.mimeType ?? 'application/octet-stream',
      fileName: document.fileName ?? 'diagnostic',
    };
  }

  async decidePropertyDocument(documentId: string, dto: DiagnosticDecisionDto, actor: FileActor) {
    const document = await this.prisma.propertyDocument.findUnique({
      where: { id: documentId },
      include: { property: true },
    });
    if (!document) throw new NotFoundException('Diagnostic introuvable.');
    const property = document.property;
    if (property.reviewRevision !== dto.expectedRevision)
      throw new ConflictException(PROPERTY_CHANGED);
    if (property.status !== PropertyStatus.PENDING_REVIEW)
      throw new ConflictException(
        'Ce bien doit être soumis au contrôle pour décider sur ses diagnostics.',
      );
    const verified = dto.decision === 'VERIFY';
    if (!verified && !dto.reason?.trim())
      throw new BadRequestException('Un refus doit être motivé.');
    if (verified && document.status === DocumentStatus.VERIFIED)
      throw new ConflictException('Ce diagnostic est déjà vérifié.');

    const date = (value: string | undefined) => {
      if (!value) return null;
      const parsed = new Date(value + 'T00:00:00.000Z');
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        throw new BadRequestException('Date de diagnostic invalide.');
      return parsed;
    };
    const issuedAt = date(dto.issuedAt);
    // Une date de fin inclut la journée indiquée. Aucun délai légal n'est deviné.
    const expiryDay = date(dto.expiresAt);
    const expiresAt = expiryDay ? new Date(expiryDay.getTime() + 86_400_000 - 1) : null;
    if (verified) {
      if (document.type === 'DPE' && (!issuedAt || !expiresAt))
        throw new BadRequestException(
          'Renseignez les dates de réalisation et de fin de validité du DPE.',
        );
      if (issuedAt && issuedAt.getTime() > Date.now())
        throw new BadRequestException('La date de réalisation ne peut pas être dans le futur.');
      if (expiresAt && (expiresAt.getTime() <= Date.now() || (issuedAt && expiresAt < issuedAt)))
        throw new BadRequestException('Le diagnostic est expiré ou ses dates sont incohérentes.');
      if (
        document.type === 'DPE' &&
        (!dto.energyRating || dto.energyRating !== property.energyRating)
      )
        throw new BadRequestException(
          'La classe lue sur le DPE doit correspondre à celle de l’annonce. Renvoyez le bien au propriétaire en cas d’écart.',
        );
      await this.assertReadable(document.storageKey);
    }
    await this.prisma.$transaction(async (tx) => {
      const revision = await advancePropertyRevision(tx, property);
      await tx.propertyDocument.update({
        where: { id: document.id },
        data: verified
          ? {
              status: DocumentStatus.VERIFIED,
              verifiedAt: new Date(),
              issuedAt,
              expiresAt,
              rejectionReason: null,
              verificationNote: 'Contrôle manuel par un agent whoma',
            }
          : {
              status: DocumentStatus.REJECTED,
              verifiedAt: null,
              rejectionReason: dto.reason!.trim(),
              verificationNote: null,
            },
      });
      await recordPropertyEvent(tx, property.id, revision, actor, {
        action: verified ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED',
        title: verified ? 'Diagnostic validé' : 'Diagnostic refusé',
        note: `${document.type} · ${document.fileName ?? 'Document'}${dto.reason?.trim() ? ' · ' + dto.reason.trim() : ''}`,
        snapshot: {
          documentId,
          type: document.type,
          fileName: document.fileName,
          reviewedRevision: dto.expectedRevision,
          addressLine: property.addressLine,
          energyRating: property.energyRating,
          surfaceM2: property.surfaceM2,
          issuedAt: issuedAt?.toISOString() ?? null,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      });
    });
    return this.listProperties();
  }

  async listProperties(): Promise<AdminPropertyRow[]> {
    const properties = await this.prisma.property.findMany({
      where: { OR: [{ status: { not: PropertyStatus.DRAFT } }, { reviewNote: { not: null } }] },
      orderBy: [{ status: 'asc' }, { updatedAt: 'asc' }],
      include: {
        owner: { select: { firstName: true, lastName: true } },
        district: { select: { name: true } },
        photos: { select: { id: true } },
        documents: true,
        reviewEvents: { orderBy: { revision: 'desc' }, take: 30 },
      },
    });

    const saved = await this.saved.countsByProperty(properties.map((p) => p.id));

    return properties.map((property) => ({
      reference: property.reference,
      revision: property.reviewRevision,
      addressLine: property.addressLine,
      energyRating: property.energyRating,
      reviewNote: property.reviewNote,
      documents: property.documents.map((document) => ({
        id: document.id,
        type: document.type,
        status: diagnosticStatus(document),
        fileName: document.fileName,
        hasFile: Boolean(document.storageKey),
        issuedAt: document.issuedAt?.toISOString() ?? null,
        expiresAt: document.expiresAt?.toISOString() ?? null,
        note: document.rejectionReason ?? document.verificationNote,
        uploadedAt: document.updatedAt.toISOString(),
      })),
      history: property.reviewEvents.map(propertyEventView),
      title: property.title,
      ownerName: `${property.owner.firstName} ${property.owner.lastName}`,
      district: property.district.name,
      status: property.status,
      totalRentCents: property.rentCents + property.chargesCents,
      surfaceM2: property.surfaceM2,
      savedCount: saved.get(property.id) ?? 0,
      ...publicationChecks(property),
      submittedAt: property.updatedAt.toISOString(),
    }));
  }

  /**
   * Met une annonce en ligne, ou la renvoie à son propriétaire.
   *
   * Rejoue les prérequis de soumission, exige un DPE contrôlé et protège la
   * décision contre les changements intervenus depuis le chargement de l'écran.
   */
  async decideProperty(
    reference: string,
    decision: 'PUBLISH' | 'REJECT',
    expectedRevision: number,
    actor: FileActor,
    reason?: string,
  ): Promise<AdminPropertyRow[]> {
    const property = await this.prisma.property.findUnique({
      where: { reference },
      include: {
        photos: { select: { id: true } },
        documents: true,
      },
    });
    if (!property) throw new NotFoundException('Bien introuvable.');
    if (property.reviewRevision !== expectedRevision) throw new ConflictException(PROPERTY_CHANGED);

    if (property.status !== PropertyStatus.PENDING_REVIEW) {
      throw new ConflictException('Ce bien n’est pas en attente de contrôle.');
    }

    if (decision === 'PUBLISH') {
      const { blockers } = publicationChecks(property);
      if (blockers.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Ce bien ne remplit pas les conditions de publication.',
          blockers,
        });
      }

      await this.prisma.$transaction(async (tx) => {
        const revision = await advancePropertyRevision(tx, property, {
          status: PropertyStatus.ONLINE,
          publishedAt: new Date(),
          reviewNote: null,
        });
        await recordPropertyEvent(tx, property.id, revision, actor, {
          action: 'PROPERTY_PUBLISHED',
          title: 'Annonce publiée',
          note: 'Diagnostics contrôlés et publication validée.',
        });
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
      await this.prisma.$transaction(async (tx) => {
        const revision = await advancePropertyRevision(tx, property, {
          status: PropertyStatus.DRAFT,
          reviewNote: reason.trim(),
        });
        await recordPropertyEvent(tx, property.id, revision, actor, {
          action: 'PROPERTY_REJECTED',
          title: 'Annonce renvoyée au propriétaire',
          note: reason.trim(),
        });
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
      const progress = signatureProgress(lease.signatureEvents);
      const fee = lease.payments[0] ?? null;

      return {
        reference: lease.reference,
        propertyReference: lease.property.reference,
        tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        status: lease.status,
        signedCount: progress.count,
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
      agentName: visit.agent ? `${visit.agent.firstName} ${visit.agent.lastName.charAt(0)}.` : null,
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
    const [properties, applications, documents, visits, leases, diagnostics] = await Promise.all([
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
      this.prisma.tenantFileEvent.findMany({
        orderBy: { createdAt: 'desc' },
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
      this.prisma.propertyReviewEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { property: { select: { reference: true } } },
      }),
    ]);

    const entries: JournalEntry[] = [
      ...diagnostics.map((event) => ({
        ...propertyEventView(event),
        title: `${event.property.reference} — ${event.title}`,
      })),
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
      ...documents.map((event) => ({
        ...fileEventView(event),
        title: `${event.tenantFile.reference} — ${event.title}`,
      })),
      ...visits.map((visit) => ({
        at: visit.updatedAt.toISOString(),
        tone: (visit.status === VisitStatus.CANCELLED ? 'reject' : 'pending') as
          'reject' | 'pending',
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
