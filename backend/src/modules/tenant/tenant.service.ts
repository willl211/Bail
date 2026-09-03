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
} from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
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
};

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
    const existing = await this.prisma.tenantFile.findUnique({
      where: { tenantId },
      include: { documents: true, guarantors: true },
    });
    if (existing) return existing;

    return this.prisma.$transaction(
      async (tx) =>
        tx.tenantFile.create({
          data: { tenantId, reference: await this.nextReference(tx) },
          include: { documents: true, guarantors: true },
        }),
      // `Serializable` : deux onglets ouverts en même temps ne doivent pas
      // pouvoir réserver la même référence.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
        'Votre dossier est en cours de contrôle. Attendez le retour de Bail pour le modifier.',
      );
    }
  }

  /**
   * Retire le sceau « vérifié » quand le contenu du dossier change.
   *
   * Sans ça, ajouter une pièce à un dossier vérifié laisserait le dossier
   * marqué vérifié alors que la pièce ajoutée n'a été contrôlée par personne.
   */
  private async unsealIfVerified(file: TenantFile): Promise<void> {
    if (file.status !== TenantFileStatus.VERIFIED) return;

    await this.prisma.tenantFile.update({
      where: { id: file.id },
      data: { status: TenantFileStatus.SUBMITTED, verifiedAt: null },
    });
  }

  async getFile(tenantId: string): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    return this.toView(tenantId, file);
  }

  async updateFile(tenantId: string, dto: UpdateTenantFileDto): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    TenantService.assertEditable(file);

    const data: Prisma.TenantFileUpdateInput = {};
    if (dto.contractType !== undefined) data.contractType = dto.contractType;
    if (dto.employerName !== undefined) data.employerName = dto.employerName || null;
    if (dto.inProbationPeriod !== undefined) data.inProbationPeriod = dto.inProbationPeriod;
    if (dto.netMonthlyIncomeCents !== undefined) {
      data.netMonthlyIncomeCents = dto.netMonthlyIncomeCents;
    }

    // Changer de situation change les pièces exigées : le dossier vérifié ne
    // l'est plus pour la nouvelle situation.
    if (dto.contractType !== undefined && dto.contractType !== file.contractType) {
      await this.unsealIfVerified(file);
    }

    const updated = await this.prisma.tenantFile.update({
      where: { id: file.id },
      data,
      include: { documents: true, guarantors: true },
    });

    return this.toView(tenantId, updated);
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

    const existing = tenantFile.documents.filter((document) => document.type === type);
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

    const created = await this.prisma.tenantDocument.create({
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

    await this.runVerification(created);
    await this.unsealIfVerified(tenantFile);
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
        verificationNote: 'Contrôle indisponible · la pièce sera revue par un agent Bail',
      };
    }

    await this.prisma.tenantDocument.update({ where: { id: document.id }, data });
  }

  async removeDocument(tenantId: string, documentId: string): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);
    TenantService.assertEditable(file);

    const document = file.documents.find((entry) => entry.id === documentId);
    // 404 et non 403 : répondre « interdit » confirmerait que la pièce existe
    // chez quelqu'un d'autre.
    if (!document) throw new NotFoundException('Pièce introuvable.');

    if (document.storageKey) {
      await this.storage.remove('private', document.storageKey);
    }
    await this.prisma.tenantDocument.delete({ where: { id: document.id } });
    await this.unsealIfVerified(file);

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
    if (existing) {
      await this.prisma.guarantor.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.guarantor.create({ data: { ...data, tenantFileId: file.id } });
    }
    await this.unsealIfVerified(file);

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
    for (const document of documents) {
      if (document.storageKey) await this.storage.remove('private', document.storageKey);
    }
    await this.prisma.tenantDocument.deleteMany({
      where: { id: { in: documents.map((document) => document.id) } },
    });
    await this.prisma.guarantor.delete({ where: { id: existing.id } });
    await this.unsealIfVerified(file);

    return this.getFile(tenantId);
  }

  // ---------------------------------------------------------------- Dépôt

  /** Soumet le dossier au contrôle de Bail. */
  async submit(tenantId: string): Promise<TenantFileView> {
    const file = await this.fileOf(tenantId);

    if (file.status === TenantFileStatus.UNDER_REVIEW) {
      throw new ConflictException('Votre dossier est déjà en cours de contrôle.');
    }

    const view = await this.toView(tenantId, file);
    if (view.missing.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Votre dossier n’est pas encore complet.',
        missing: view.missing,
      });
    }

    await this.prisma.tenantFile.update({
      where: { id: file.id },
      data: { status: TenantFileStatus.SUBMITTED, submittedAt: new Date() },
    });

    return this.getFile(tenantId);
  }

  // ---------------------------------------------------------------- Lecture

  /**
   * Statut agrégé d'un ensemble de pièces — une ligne, ou tout un groupe.
   *
   * Ne prend que les statuts : ça permet de la réutiliser sur des lignes déjà
   * transformées pour l'affichage, sans reconstruire de faux documents.
   */
  private static aggregate(documents: { status: DocumentStatus }[]): DocumentStatus | 'MISSING' {
    if (documents.length === 0) return 'MISSING';
    // L'état le plus défavorable l'emporte : une ligne dont une pièce est
    // refusée n'est pas « vérifiée », même si les autres le sont.
    if (documents.some((d) => d.status === DocumentStatus.REJECTED)) {
      return DocumentStatus.REJECTED;
    }
    if (documents.some((d) => d.status === DocumentStatus.EXPIRED)) {
      return DocumentStatus.EXPIRED;
    }
    if (documents.some((d) => d.status === DocumentStatus.PROCESSING)) {
      return DocumentStatus.PROCESSING;
    }
    if (documents.some((d) => d.status === DocumentStatus.PENDING)) {
      return DocumentStatus.PENDING;
    }
    return DocumentStatus.VERIFIED;
  }

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
          .filter((document) => document.type === slot.type)
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
          status: TenantService.aggregate(documents),
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
        slot.status === 'MISSING'
          ? `${slot.label} — à déposer`
          : `${slot.label} — à remplacer`,
      );

    const awaiting = requiredSlots
      .filter(
        (slot) =>
          slot.status === DocumentStatus.PENDING ||
          slot.status === DocumentStatus.PROCESSING,
      )
      .map((slot) => `${slot.label} — en cours de contrôle`);

    if (file.contractType === null) missing.push('Votre situation — à renseigner');
    if (file.netMonthlyIncomeCents === null) missing.push('Vos revenus — à renseigner');

    const groupStatus = (group: DocumentGroup): DocumentStatus | 'MISSING' => {
      const inGroup = requiredSlots.filter((slot) => slot.group === group);
      if (inGroup.length === 0) return 'MISSING';
      // Une ligne requise mais vide rend tout le groupe incomplet : agréger
      // seulement les fichiers déposés dirait « vérifié » sur un groupe dont
      // une pièce manque.
      if (inGroup.some((slot) => slot.status === 'MISSING')) return 'MISSING';
      return TenantService.aggregate(inGroup.flatMap((slot) => slot.documents));
    };

    const incomeVerified =
      requiredSlots.some((slot) => slot.group === 'income') &&
      requiredSlots
        .filter((slot) => slot.group === 'income')
        .every((slot) => slot.status === DocumentStatus.VERIFIED);

    return {
      reference: file.reference,
      status: file.status,
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
        income: groupStatus('income'),
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
      journal: TenantService.journal(file),
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
