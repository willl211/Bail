import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  DocumentType,
  EmploymentContractType,
  GuarantorKind,
  Prisma,
  TenantFileStatus,
  type Guarantor,
  type TenantDocument,
  type TenantFile,
  type TenantFileEvent,
} from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import type { CompatibilityFile } from '../properties/compatibility';
import { DOCUMENT_TYPES, IncomingFile, StorageService } from '../storage/storage.service';
import { VERIFICATION_DRIVER, type VerificationDriver } from '../verification/verification.driver';
import { UpsertGuarantorDto } from './dto/upsert-guarantor.dto';
import { UpdateTenantFileDto } from './dto/update-tenant-file.dto';
import {
  SLOTS,
  SLOT_BY_TYPE,
  guarantorSlotLabel,
  requiredTypes,
  type DocumentGroup,
} from './tenant.slots';
import {
  aggregateDocumentStatus,
  documentsForType,
  isCurrentVerification,
  profileMissing,
} from './tenant-file.policy';
import { advanceFileRevision, fileEventView, recordFileEvent } from './tenant-file.revision';

/**
 * Taux d'effort maximal admis par les propriétaires du pilote : le loyer
 * charges comprises ne doit pas dépasser le tiers des revenus nets. C'est la
 * règle que le seed applique aux critères des biens
 * (`minMonthlyIncomeCents = loyer CC × 3`), et le « loyer accessible » affiché
 * au locataire en est l'exacte réciproque — les deux doivent rester cohérents.
 */
const MAX_EFFORT_DIVISOR = 3;

export interface TenantDocumentView {
  id: string;
  /**
   * Un fichier est-il réellement stocké ?
   *
   * Une pièce peut exister en base sans fichier — c'est le cas du jeu de
   * démonstration, et ce le sera d'une pièce enregistrée par le back-office
   * sur justificatif présenté en agence. Sans ce drapeau, l'écran proposerait
   * de l'ouvrir et tomberait sur un 404.
   */
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  status: DocumentStatus;
  /** Résultat lisible du contrôle, quand il a eu lieu. */
  verificationNote: string | null;
  rejectionReason: string | null;
  uploadedAt: string;
}

/** Une ligne de l'écran : ce qui est attendu, et ce qui a été déposé. */
export interface TenantSlotView {
  type: DocumentType;
  label: string;
  hint: string;
  group: DocumentGroup;
  max: number;
  required: boolean;
  /** Statut de la ligne, agrégé sur ses fichiers. */
  status: DocumentStatus | 'MISSING';
  documents: TenantDocumentView[];
}

export interface TenantGuarantorView {
  id: string;
  kind: GuarantorKind;
  firstName: string | null;
  lastName: string | null;
  organisationName: string | null;
  relationship: string | null;
  netMonthlyIncomeCents: number | null;
  contractType: EmploymentContractType | null;
}

export interface TenantJournalEntry {
  at: string;
  tone: 'ok' | 'pending' | 'reject' | 'neutral';
  title: string;
  note: string;
}

export interface TenantFileView {
  reference: string;
  revision: number;
  verifiedRevision: number | null;
  status: TenantFileStatus;
  holderName: string;
  contractType: EmploymentContractType | null;
  employerName: string | null;
  inProbationPeriod: boolean | null;
  netMonthlyIncomeCents: number | null;
  /** Vrai quand les pièces de revenus attendues sont toutes vérifiées. */
  incomeVerified: boolean;
  /** Loyer charges comprises que les critères courants rendent accessible. */
  maxRentCents: number | null;
  verifiedSlotCount: number;
  expectedSlotCount: number;
  /**
   * Ce que le locataire doit encore faire : déposer ou remplacer une pièce,
   * renseigner sa situation. C'est ce qui empêche de transmettre le dossier.
   */
  missing: string[];
  /**
   * Pièces déposées dont le contrôle n'est pas rendu. Informatif : elles
   * n'empêchent pas de transmettre — c'est justement pour les faire contrôler
   * qu'on transmet.
   */
  awaiting: string[];
  groups: Record<DocumentGroup, DocumentStatus | 'MISSING'>;
  slots: TenantSlotView[];
  guarantor: TenantGuarantorView | null;
  journal: TenantJournalEntry[];
  submittedAt: string | null;
  verifiedAt: string | null;
  /** Driver de vérification actif : `mock` tant qu'aucun prestataire n'est retenu. */
  verificationDriver: string;
}

type FileWithRelations = TenantFile & {
  documents: TenantDocument[];
  guarantors: Guarantor[];
  events: TenantFileEvent[];
};

const FILE_RELATIONS = {
  documents: true,
  guarantors: true,
  events: { orderBy: { revision: 'desc' }, take: 40 },
} satisfies Prisma.TenantFileInclude;

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(VERIFICATION_DRIVER) private readonly verification: VerificationDriver,
  ) {}

  // ---------------------------------------------------------------- Dossier

  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `LOC-${new Date().getFullYear()}-`;
    const last = await tx.tenantFile.findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const current = last ? parseInt(last.reference.slice(prefix.length), 10) : 0;
    return `${prefix}${String(current + 1).padStart(4, '0')}`;
  }

  /**
   * Dossier du locataire, créé à la première consultation.
   *
   * Créé ici plutôt qu'à l'inscription : un compte locataire peut servir à
   * consulter des annonces sans jamais monter de dossier, et ouvrir des
   * dossiers vides à l'inscription remplirait la base de coquilles que le
   * back-office devrait trier.
   */
  private async fileOf(tenantId: string): Promise<FileWithRelations> {
    // « Lire puis créer » n'est pas atomique, et deux requêtes simultanées sur
    // un compte sans dossier sont un cas ordinaire : deux onglets, un
    // rechargement pendant le chargement, l'écran de candidature qui lit le
    // dossier en même temps que l'espace locataire. Les deux passent le
    // `findUnique`, puis se disputent la création. Deux issues, toutes deux
    // normales, aucune n'étant une erreur à remonter au locataire :
    //
    //  - P2002, l'autre a déjà créé le dossier : on relit le sien ;
    //  - P2034, conflit de sérialisation (l'isolation `Serializable` protège
    //    la numérotation des références) : PostgreSQL demande de rejouer.
    for (let attempt = 0; ; attempt += 1) {
      const existing = await this.prisma.tenantFile.findUnique({
        where: { tenantId },
        include: FILE_RELATIONS,
      });
      if (existing) return existing;

      try {
        return await this.prisma.$transaction(
          async (tx) =>
            tx.tenantFile.create({
              data: { tenantId, reference: await this.nextReference(tx) },
              include: FILE_RELATIONS,
            }),
          // Sans `Serializable`, deux dossiers ouverts en même temps
          // réserveraient la même référence.
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034');

        // La borne existe pour ne pas boucler indéfiniment si la cause n'était
        // pas la concurrence : au-delà, l'erreur remonte telle quelle.
        if (!retryable || attempt >= 3) throw error;
      }
    }
  }

  /**
   * Dossier et identifiant technique en une seule lecture.
   *
   * Une candidature a besoin des deux : la synthèse à montrer au locataire, et
   * l'identifiant pour rattacher `Application.tenantFileId`. Les obtenir par
   * deux appels séparés ouvrirait deux fois le dossier d'un compte qui n'en a
   * pas encore. Cet identifiant technique ne sort pas de `TenantFileView` : le
   * reste de l'application ne connaît le dossier que par sa référence lisible.
   */
  async getFileWithId(tenantId: string): Promise<{ view: TenantFileView; id: string }> {
    const file = await this.fileOf(tenantId);
    return { view: await this.toView(tenantId, file), id: file.id };
  }

  /**
   * Le dossier est-il modifiable ?
   *
   * Seul le contrôle en cours verrouille : un agent est en train de le lire, et
   * changer les pièces sous ses yeux lui ferait valider autre chose que ce
   * qu'il a examiné.
   *
   * Un dossier **vérifié** reste modifiable. Le figer condamnerait le locataire
   * à ne jamais mettre à jour un bulletin de salaire ou un justificatif de
   * domicile après un déménagement — or un dossier est vivant tant qu'on
   * candidate.
   */
  private static assertEditable(file: TenantFile): void {
    if (file.status === TenantFileStatus.UNDER_REVIEW) {
      throw new ConflictException(
        'Votre dossier est en cours de contrôle. Attendez le retour de whoma pour le modifier.',
      );
    }
  }

  async getFile(tenantId: string): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    return this.toView(tenantId, file);
  }

  /**
   * Dossier réduit à ce que la note de compatibilité regarde.
   *
   * **Lecture seule**, contrairement à `getFile` qui crée le dossier s'il
   * n'existe pas encore : le classement des annonces passe ici à chaque
   * recherche, et ouvrir un dossier vide à quelqu'un qui n'a fait que chercher
   * serait un effet de bord invisible et faux.
   *
   * `null` quand il n'y a pas de dossier — les annonces s'affichent alors dans
   * l'ordre par défaut, sans que la recherche échoue.
   */
  async compatibilitySummary(tenantId: string): Promise<CompatibilityFile | null> {
    const file = await this.prisma.tenantFile.findUnique({
      where: { tenantId },
      include: FILE_RELATIONS,
    });
    if (!file) return null;

    return toCompatibilityFile(await this.toView(tenantId, file));
  }

  async updateFile(tenantId: string, dto: UpdateTenantFileDto): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    TenantService.assertEditable(file);

    const data: Prisma.TenantFileUpdateManyMutationInput = {};
    if (dto.contractType !== undefined) data.contractType = dto.contractType;
    if (dto.employerName !== undefined) data.employerName = dto.employerName || null;
    if (dto.inProbationPeriod !== undefined) data.inProbationPeriod = dto.inProbationPeriod;
    if (dto.netMonthlyIncomeCents !== undefined) {
      data.netMonthlyIncomeCents = dto.netMonthlyIncomeCents;
    }

    const labels = {
      contractType: 'situation professionnelle',
      employerName: 'employeur',
      inProbationPeriod: 'période d’essai',
      netMonthlyIncomeCents: 'revenus mensuels',
    };
    const changed = (Object.keys(labels) as (keyof typeof labels)[]).filter(
      (key) => data[key] !== undefined && data[key] !== file[key],
    );
    if (changed.length === 0) return this.toView(tenantId, file);

    await this.prisma.$transaction(async (tx) => {
      const revision = await advanceFileRevision(tx, file, data);
      // Les contrôles antérieurs ne prouvent pas les nouvelles déclarations.
      // Les pièces restent disponibles, les refus restent motivés.
      await tx.tenantDocument.updateMany({
        where: {
          tenantFileId: file.id,
          type: { in: SLOTS.filter((slot) => slot.group === 'income').map((slot) => slot.type) },
          status: { in: [DocumentStatus.VERIFIED, DocumentStatus.PROCESSING] },
        },
        data: {
          status: DocumentStatus.PENDING,
          verifiedAt: null,
          verificationNote: 'Informations professionnelles modifiées · rapprochement à refaire',
          rejectionReason: null,
        },
      });
      await recordFileEvent(
        tx,
        file.id,
        revision,
        { id: tenantId, label: 'Locataire' },
        {
          action: 'PROFILE_UPDATED',
          title: 'Informations mises à jour',
          note: `${changed.map((key) => labels[key]).join(', ')}. Une nouvelle validation est nécessaire.`,
        },
      );
    });
    return this.getFile(tenantId);
  }

  // ---------------------------------------------------------------- Pièces

  async addDocument(
    tenantId: string,
    type: DocumentType,
    file: IncomingFile,
  ): Promise<TenantFileView> {
    const slot = SLOT_BY_TYPE.get(type);
    if (!slot) throw new BadRequestException('Type de pièce inconnu.');

    const tenantFile = await this.fileOf(tenantId);
    TenantService.assertEditable(tenantFile);

    if (slot.group === 'guarantor' && tenantFile.guarantors.length === 0) {
      throw new BadRequestException('Déclarez d’abord votre garant avant de déposer ses pièces.');
    }

    const existing = documentsForType(tenantFile.documents, type);
    if (existing.length >= slot.max) {
      throw new ConflictException(
        slot.max === 1
          ? 'Cette pièce est déjà déposée. Retirez-la pour en déposer une autre.'
          : `Cette ligne accepte ${slot.max} fichiers au maximum.`,
      );
    }

    // Régime privé : une pièce de dossier ne doit jamais avoir d'URL publique.
    const stored = await this.storage.save(
      'private',
      `tenants/${tenantFile.reference.toLowerCase()}`,
      file,
      DOCUMENT_TYPES,
    );

    let created: TenantDocument;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const revision = await advanceFileRevision(tx, tenantFile);
        const document = await tx.tenantDocument.create({
          data: {
            tenantFileId: tenantFile.id,
            type,
            status: DocumentStatus.PROCESSING,
            fileName: file.originalname.slice(0, 200),
            mimeType: stored.mimeType,
            fileSize: stored.size,
            storageKey: stored.key,
          },
        });
        await recordFileEvent(
          tx,
          tenantFile.id,
          revision,
          { id: tenantId, label: 'Locataire' },
          {
            action: 'DOCUMENT_ADDED',
            title: 'Pièce ajoutée',
            note: slot.label,
          },
        );
        return document;
      });
    } catch (error) {
      await this.storage.remove('private', stored.key);
      throw error;
    }

    await this.runVerification(created);
    return this.getFile(tenantId);
  }

  /**
   * Soumet une pièce au prestataire et enregistre son verdict.
   *
   * Un échec du prestataire ne perd pas le fichier : la pièce retombe en
   * attente de contrôle, et le locataire n'a rien à redéposer.
   */
  private async runVerification(document: TenantDocument): Promise<void> {
    let data: Prisma.TenantDocumentUpdateInput;

    try {
      const outcome = await this.verification.verify({
        documentId: document.id,
        type: document.type,
        mimeType: document.mimeType ?? 'application/octet-stream',
        fileName: document.fileName ?? '',
        storageKey: document.storageKey ?? '',
      });

      switch (outcome.status) {
        case 'verified':
          data = {
            status: DocumentStatus.VERIFIED,
            verificationNote: outcome.note,
            verifiedAt: new Date(),
            rejectionReason: null,
          };
          break;
        case 'rejected':
          data = {
            status: DocumentStatus.REJECTED,
            rejectionReason: outcome.reason,
            verificationNote: null,
            verifiedAt: null,
          };
          break;
        case 'manual':
          data = {
            status: DocumentStatus.PENDING,
            verificationNote: outcome.note,
            verifiedAt: null,
            rejectionReason: null,
          };
          break;
        case 'processing':
          data = {
            status: DocumentStatus.PROCESSING,
            verificationNote: 'Contrôle en cours auprès du prestataire',
            verifiedAt: null,
            rejectionReason: null,
          };
          break;
      }
    } catch {
      data = {
        status: DocumentStatus.PENDING,
        verificationNote: 'Contrôle indisponible · la pièce sera revue par un agent whoma',
      };
    }

    // Un retour tardif du prestataire ne doit écraser ni une décision humaine,
    // ni l'invalidation provoquée par une modification des informations.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.prisma.tenantDocument.findUnique({
        where: { id: document.id },
        include: { tenantFile: true },
      });
      if (
        !current ||
        current.status !== DocumentStatus.PROCESSING ||
        current.updatedAt.getTime() !== document.updatedAt.getTime()
      )
        return;
      try {
        await this.prisma.$transaction(async (tx) => {
          const revision = await advanceFileRevision(tx, current.tenantFile);
          await tx.tenantDocument.update({ where: { id: document.id }, data });
          await recordFileEvent(
            tx,
            current.tenantFileId,
            revision,
            {
              label: `Prestataire ${this.verification.name}${this.verification.name === 'mock' ? ' (simulé)' : ''}`,
            },
            {
              action:
                data.status === DocumentStatus.VERIFIED
                  ? 'DOCUMENT_VERIFIED'
                  : data.status === DocumentStatus.REJECTED
                    ? 'DOCUMENT_REJECTED'
                    : 'DOCUMENT_PENDING',
              title: 'Résultat du contrôle de pièce',
              note: `${SLOT_BY_TYPE.get(document.type)?.label ?? document.type} · ${String(data.verificationNote ?? data.rejectionReason ?? 'En attente')}`,
            },
          );
        });
        return;
      } catch (error) {
        if (!(error instanceof ConflictException) || attempt === 3) throw error;
      }
    }
  }

  async removeDocument(tenantId: string, documentId: string): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    TenantService.assertEditable(file);

    const document = file.documents.find((entry) => entry.id === documentId);
    // 404 et non 403 : répondre « interdit » confirmerait que la pièce existe
    // chez quelqu'un d'autre.
    if (!document) throw new NotFoundException('Pièce introuvable.');

    await this.prisma.$transaction(async (tx) => {
      const revision = await advanceFileRevision(tx, file);
      await tx.tenantDocument.delete({ where: { id: document.id } });
      await recordFileEvent(
        tx,
        file.id,
        revision,
        { id: tenantId, label: 'Locataire' },
        {
          action: 'DOCUMENT_REMOVED',
          title: 'Pièce retirée',
          note: SLOT_BY_TYPE.get(document.type)?.label ?? document.type,
        },
      );
    });
    if (document.storageKey) await this.storage.remove('private', document.storageKey);

    return this.getFile(tenantId);
  }

  /**
   * Lecture d'une pièce.
   *
   * Seule sortie possible d'un fichier privé : le contenu ne transite qu'après
   * vérification que le demandeur est bien le titulaire du dossier.
   */
  async readDocument(
    tenantId: string,
    documentId: string,
  ): Promise<{ stream: Readable; mimeType: string; fileName: string }> {
    const file = await this.fileOf(tenantId);
    const document = file.documents.find((entry) => entry.id === documentId);
    if (!document?.storageKey) throw new NotFoundException('Pièce introuvable.');

    return {
      stream: await this.storage.read('private', document.storageKey),
      mimeType: document.mimeType ?? 'application/octet-stream',
      fileName: document.fileName ?? 'document',
    };
  }

  // ---------------------------------------------------------------- Garant

  async upsertGuarantor(tenantId: string, dto: UpsertGuarantorDto): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    TenantService.assertEditable(file);

    if (dto.kind === GuarantorKind.INDIVIDUAL && !(dto.firstName && dto.lastName)) {
      throw new BadRequestException('Nom et prénom du garant sont requis.');
    }
    if (dto.kind === GuarantorKind.ORGANISATION && !dto.organisationName) {
      throw new BadRequestException('Le nom de l’organisme est requis.');
    }

    const data = {
      kind: dto.kind,
      firstName: dto.kind === GuarantorKind.INDIVIDUAL ? (dto.firstName ?? null) : null,
      lastName: dto.kind === GuarantorKind.INDIVIDUAL ? (dto.lastName ?? null) : null,
      organisationName:
        dto.kind === GuarantorKind.ORGANISATION ? (dto.organisationName ?? null) : null,
      relationship: dto.relationship ?? null,
      // Un organisme de cautionnement n'a pas de revenus : en enregistrer
      // n'aurait aucun sens et fausserait ce que voit le propriétaire.
      netMonthlyIncomeCents:
        dto.kind === GuarantorKind.INDIVIDUAL ? (dto.netMonthlyIncomeCents ?? null) : null,
      contractType: dto.kind === GuarantorKind.INDIVIDUAL ? (dto.contractType ?? null) : null,
    };

    const existing = file.guarantors[0];
    if (
      existing &&
      (Object.keys(data) as (keyof typeof data)[]).every((key) => data[key] === existing[key])
    )
      return this.toView(tenantId, file);
    const identityChanged =
      existing &&
      ['kind', 'firstName', 'lastName', 'organisationName'].some(
        (key) => data[key as keyof typeof data] !== existing[key as keyof typeof data],
      );
    const obsolete = identityChanged
      ? file.documents.filter((document) =>
          [DocumentType.GUARANTOR_ID, DocumentType.GUARANTOR_INCOME].includes(
            document.type as 'GUARANTOR_ID' | 'GUARANTOR_INCOME',
          ),
        )
      : [];
    await this.prisma.$transaction(async (tx) => {
      const revision = await advanceFileRevision(tx, file);
      if (existing)
        await tx.guarantor.update({
          where: { id: existing.id },
          data: { ...data, status: DocumentStatus.PENDING },
        });
      else await tx.guarantor.create({ data: { ...data, tenantFileId: file.id } });
      if (identityChanged) {
        await tx.tenantDocument.deleteMany({
          where: { id: { in: obsolete.map((document) => document.id) } },
        });
      } else {
        await tx.tenantDocument.updateMany({
          where: {
            tenantFileId: file.id,
            type: { in: [DocumentType.GUARANTOR_ID, DocumentType.GUARANTOR_INCOME] },
            status: { in: [DocumentStatus.VERIFIED, DocumentStatus.PROCESSING] },
          },
          data: {
            status: DocumentStatus.PENDING,
            verifiedAt: null,
            verificationNote: 'Informations du garant modifiées · contrôle à refaire',
            rejectionReason: null,
          },
        });
      }
      await recordFileEvent(
        tx,
        file.id,
        revision,
        { id: tenantId, label: 'Locataire' },
        {
          action: 'GUARANTOR_UPDATED',
          title: 'Garant mis à jour',
          note: identityChanged
            ? 'Le garant a changé : ses justificatifs sont à déposer à nouveau.'
            : 'Les informations du garant doivent être contrôlées.',
        },
      );
    });
    for (const document of obsolete) {
      if (document.storageKey) await this.storage.remove('private', document.storageKey);
    }

    return this.getFile(tenantId);
  }

  async removeGuarantor(tenantId: string): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    TenantService.assertEditable(file);

    const existing = file.guarantors[0];
    if (!existing) throw new NotFoundException('Aucun garant déclaré.');

    // Les pièces du garant partent avec lui : les laisser orphelines
    // conserverait la carte d'identité d'un tiers sans raison de la garder.
    const documents = file.documents.filter(
      (document) =>
        document.type === DocumentType.GUARANTOR_ID ||
        document.type === DocumentType.GUARANTOR_INCOME,
    );
    await this.prisma.$transaction(async (tx) => {
      const revision = await advanceFileRevision(tx, file);
      await tx.tenantDocument.deleteMany({
        where: { id: { in: documents.map((document) => document.id) } },
      });
      await tx.guarantor.delete({ where: { id: existing.id } });
      await recordFileEvent(
        tx,
        file.id,
        revision,
        { id: tenantId, label: 'Locataire' },
        {
          action: 'GUARANTOR_REMOVED',
          title: 'Garant retiré',
          note: 'Le garant et ses pièces ont été retirés du dossier.',
        },
      );
    });
    for (const document of documents) {
      if (document.storageKey) await this.storage.remove('private', document.storageKey);
    }

    return this.getFile(tenantId);
  }

  // ---------------------------------------------------------------- Dépôt

  /** Soumet le dossier au contrôle de whoma. */
  async submit(tenantId: string): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);

    if (file.status === TenantFileStatus.UNDER_REVIEW) {
      throw new ConflictException('Votre dossier est déjà en cours de contrôle.');
    }
    if (file.status === TenantFileStatus.VERIFIED || file.status === TenantFileStatus.SUBMITTED) {
      throw new ConflictException('Votre dossier est déjà transmis.');
    }

    const view = await this.toView(tenantId, file);
    if (view.missing.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Votre dossier n’est pas encore complet.',
        missing: view.missing,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const revision = await advanceFileRevision(tx, file, {
        status: TenantFileStatus.SUBMITTED,
        submittedAt: new Date(),
      });
      await recordFileEvent(
        tx,
        file.id,
        revision,
        { id: tenantId, label: 'Locataire' },
        {
          action: 'FILE_SUBMITTED',
          title: 'Dossier transmis',
          note: 'Cette version du dossier est prête pour le contrôle.',
        },
      );
    });

    return this.getFile(tenantId);
  }

  // ---------------------------------------------------------------- Lecture

  private async toView(tenantId: string, file: FileWithRelations): Promise<TenantFileView> {
    const holder = await this.prisma.user.findUniqueOrThrow({
      where: { id: tenantId },
      select: { firstName: true, lastName: true },
    });

    const guarantor = file.guarantors[0] ?? null;
    const required = new Set(requiredTypes(file.contractType, guarantor?.kind ?? null));

    const slots: TenantSlotView[] = SLOTS.filter(
      // Sans garant déclaré, ses lignes n'ont pas lieu d'être : elles
      // apparaissent dès qu'on en déclare un.
      (slot) => slot.group !== 'guarantor' || guarantor !== null,
    )
      .filter(
        // Une ligne de garant qui ne s'applique pas au type déclaré
        // (pièce d'identité d'un organisme) n'est pas affichée non plus.
        (slot) => slot.group !== 'guarantor' || guarantor === null || required.has(slot.type),
      )
      .map((slot) => {
        const documents = file.documents
          .filter((document) => documentsForType([document], slot.type).length > 0)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        const renamed =
          guarantor && slot.group === 'guarantor'
            ? guarantorSlotLabel(slot.type, guarantor.kind)
            : null;

        return {
          type: slot.type,
          label: renamed?.label ?? slot.label,
          hint: renamed?.hint ?? slot.hint,
          group: slot.group,
          max: slot.max,
          required: required.has(slot.type),
          status: aggregateDocumentStatus(documents),
          documents: documents.map((document) => ({
            id: document.id,
            hasFile: document.storageKey !== null,
            fileName: document.fileName,
            fileSize: document.fileSize,
            status: document.status,
            verificationNote: document.verificationNote,
            rejectionReason: document.rejectionReason,
            uploadedAt: document.createdAt.toISOString(),
          })),
        };
        // Une ligne non requise reste affichée : un salarié peut vouloir joindre
        // son avis d'imposition même quand il n'est pas exigé.
      });

    const requiredSlots = slots.filter((slot) => slot.required);
    const verifiedSlotCount = requiredSlots.filter(
      (slot) => slot.status === DocumentStatus.VERIFIED,
    ).length;

    // Distinction essentielle : une pièce **absente ou refusée** appelle une
    // action du locataire et bloque la transmission ; une pièce **en cours de
    // contrôle** ne bloque rien — c'est précisément pour la faire contrôler
    // qu'on transmet le dossier. Confondre les deux enfermerait le locataire
    // dans un dossier qu'il ne peut jamais soumettre.
    const missing = requiredSlots
      .filter(
        (slot) =>
          slot.status === 'MISSING' ||
          slot.status === DocumentStatus.REJECTED ||
          slot.status === DocumentStatus.EXPIRED,
      )
      .map((slot) =>
        slot.status === 'MISSING' ? `${slot.label} — à déposer` : `${slot.label} — à remplacer`,
      );

    const awaiting = requiredSlots
      .filter(
        (slot) =>
          slot.status === DocumentStatus.PENDING || slot.status === DocumentStatus.PROCESSING,
      )
      .map((slot) => `${slot.label} — en cours de contrôle`);

    missing.push(...profileMissing(file));

    const groupStatus = (group: DocumentGroup): DocumentStatus | 'MISSING' => {
      const inGroup = requiredSlots.filter((slot) => slot.group === group);
      if (inGroup.length === 0) return 'MISSING';
      // Une ligne requise mais vide rend tout le groupe incomplet : agréger
      // seulement les fichiers déposés dirait « vérifié » sur un groupe dont
      // une pièce manque.
      if (inGroup.some((slot) => slot.status === 'MISSING')) return 'MISSING';
      return aggregateDocumentStatus(inGroup.flatMap((slot) => slot.documents));
    };

    const incomeVerified =
      isCurrentVerification(file) &&
      requiredSlots.some((slot) => slot.group === 'income') &&
      requiredSlots
        .filter((slot) => slot.group === 'income')
        .every((slot) => slot.status === DocumentStatus.VERIFIED);

    return {
      reference: file.reference,
      revision: file.revision,
      verifiedRevision: file.verifiedRevision,
      status:
        file.status === TenantFileStatus.VERIFIED && !isCurrentVerification(file)
          ? TenantFileStatus.SUBMITTED
          : file.status,
      holderName: `${holder.firstName} ${holder.lastName}`,
      contractType: file.contractType,
      employerName: file.employerName,
      inProbationPeriod: file.inProbationPeriod,
      netMonthlyIncomeCents: file.netMonthlyIncomeCents,
      incomeVerified,
      maxRentCents:
        file.netMonthlyIncomeCents === null
          ? null
          : Math.floor(file.netMonthlyIncomeCents / MAX_EFFORT_DIVISOR),
      verifiedSlotCount,
      expectedSlotCount: requiredSlots.length,
      missing,
      awaiting,
      groups: {
        identity: groupStatus('identity'),
        income: groupStatus('income') === DocumentStatus.VERIFIED && !incomeVerified
          ? DocumentStatus.PENDING
          : groupStatus('income'),
        housing: groupStatus('housing'),
        guarantor: guarantor === null ? 'MISSING' : groupStatus('guarantor'),
      },
      slots,
      guarantor:
        guarantor === null
          ? null
          : {
              id: guarantor.id,
              kind: guarantor.kind,
              firstName: guarantor.firstName,
              lastName: guarantor.lastName,
              organisationName: guarantor.organisationName,
              relationship: guarantor.relationship,
              netMonthlyIncomeCents: guarantor.netMonthlyIncomeCents,
              contractType: guarantor.contractType,
            },
      journal: file.events.length ? file.events.map(fileEventView) : TenantService.journal(file),
      submittedAt: file.submittedAt?.toISOString() ?? null,
      verifiedAt: file.verifiedAt?.toISOString() ?? null,
      verificationDriver: this.verification.name,
    };
  }

  /**
   * Journal de vérification.
   *
   * Reconstitué à partir des horodatages réels des pièces, jamais d'événements
   * inventés : chaque ligne correspond à un fait daté en base.
   */
  private static journal(file: FileWithRelations): TenantJournalEntry[] {
    const entries: TenantJournalEntry[] = file.documents.map((document) => {
      const label = SLOT_BY_TYPE.get(document.type)?.label ?? 'Pièce';

      if (document.status === DocumentStatus.VERIFIED && document.verifiedAt) {
        return {
          at: document.verifiedAt.toISOString(),
          tone: 'ok',
          title: `${label} vérifiée`,
          note: document.verificationNote ?? 'Contrôle automatique',
        };
      }
      if (document.status === DocumentStatus.REJECTED) {
        return {
          at: document.updatedAt.toISOString(),
          tone: 'reject',
          title: `${label} refusée`,
          note: document.rejectionReason ?? 'Pièce non conforme',
        };
      }
      return {
        at: document.createdAt.toISOString(),
        tone: 'pending',
        title: `${label} reçue`,
        note: document.verificationNote ?? 'En attente de contrôle',
      };
    });

    if (file.submittedAt) {
      entries.push({
        at: file.submittedAt.toISOString(),
        tone: 'ok',
        title: 'Dossier transmis au contrôle',
        note: file.reference,
      });
    }

    entries.push({
      at: file.createdAt.toISOString(),
      tone: 'neutral',
      title: 'Dossier créé',
      note: file.reference,
    });

    return entries.sort((a, b) => b.at.localeCompare(a.at));
  }
}

/**
 * Dossier ramené à ce que la note de compatibilité regarde.
 *
 * `TenantFileView` porte tout l'écran du dossier — pièces, manques, échéances.
 * Le barème n'en lit que six valeurs : les lui passer explicitement évite qu'il
 * se mette un jour à dépendre du reste, et garde le barème lui-même sans
 * dépendance, donc testable sur des valeurs.
 */
export function toCompatibilityFile(file: TenantFileView): CompatibilityFile {
  return {
    netMonthlyIncomeCents: file.netMonthlyIncomeCents,
    verified: file.status === TenantFileStatus.VERIFIED,
    submitted: file.submittedAt !== null,
    contractType: file.contractType,
    hasGuarantor: file.guarantor !== null,
    guarantorVerified: file.groups.guarantor === 'VERIFIED',
  };
}
