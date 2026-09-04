import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  LeaseType,
  Prisma,
  Property,
  PropertyDocumentType,
  PropertyStatus,
} from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertPropertyDto } from './dto/upsert-property.dto';
import { UpdateOwnerProfileDto } from './dto/owner-profile.dto';
import { accountBlockers } from '../auth/account.checks';
import { isAddressComplete } from './address.checks';
import { propertyChecks } from './property.checks';
import { SavedService } from '../saved/saved.service';
import {
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  IncomingFile,
  StorageService,
} from '../storage/storage.service';

/** Au-delà, une annonce devient illisible plus qu'elle n'informe. */
const MAX_PHOTOS = 12;

/** Bien tel que son propriétaire le voit — statuts internes compris. */
export interface OwnerPropertyItem {
  reference: string;
  title: string;
  district: string;
  addressLine: string;
  status: PropertyStatus;
  surfaceM2: number;
  rooms: number;
  furnished: boolean;
  /** `null` tant que le DPE n'a pas été fourni — bloque la publication. */
  energyRating: string | null;
  rentCents: number;
  chargesCents: number;
  totalRentCents: number;
  photoCount: number;
  applicationCount: number;
  /**
   * Nombre de locataires ayant mis ce bien de côté.
   *
   * Rapproché du nombre de candidatures, c'est un signal de **prix** : beaucoup
   * de sauvegardes et peu de candidatures signifient que le bien plaît mais que
   * quelque chose retient — le loyer, les critères, le garant exigé. Un
   * compteur de vues ne dirait rien d'actionnable ; celui-ci, si.
   *
   * Agrégat seulement : le propriétaire ne voit jamais qui a sauvegardé.
   */
  savedCount: number;
  publishedAt: string | null;
  /**
   * Motif du dernier renvoi par le contrôle de Bail. Le propriétaire doit le
   * lire là où il corrige : sans lui, son annonce serait repassée en brouillon
   * sans explication.
   */
  reviewNote: string | null;
  /** Ce qui empêche la publication. Vide = le bien peut être soumis. */
  blockers: string[];
  /** Ce qui la dessert sans l'empêcher (photos, description courte). */
  warnings: string[];
}

/** Bien complet pour le formulaire de dépôt. */
export interface OwnerPropertyDetail
  extends Omit<OwnerPropertyItem, 'addressLine' | 'district'> {
  description: string;
  addressLine: string;
  districtSlug: string;
  district: string;
  bedrooms: number | null;
  floor: string | null;
  gesRating: string | null;
  constructionYear: number | null;
  depositCents: number;
  availableFrom: string | null;
  availableImmediately: boolean;
  minMonthlyIncomeCents: number | null;
  guarantorRequirement: string;
  acceptedContractTypes: string[];
  photos: { id: string; label: string; url: string | null }[];
  documents: {
    id: string;
    type: PropertyDocumentType;
    status: DocumentStatus;
    fileName: string | null;
    fileSize: number | null;
    issuedAt: string | null;
    rejectionReason: string | null;
  }[];
}

/**
 * Coordonnées postales du bailleur, telles qu'elles figureront au bail.
 *
 * `complete` est calculé côté API et non déduit du front : c'est cette valeur
 * qui décide si le rappel s'affiche, et le front n'a pas à réimplémenter la
 * règle « les trois champs vont ensemble ».
 */
export interface OwnerProfile {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  complete: boolean;
}

export interface OwnerSummary {
  /** Biens diffusés, donc facturés. */
  onlineCount: number;
  draftCount: number;
  /** Soumis au contrôle Bail : ni brouillon, ni encore diffusé. */
  pendingReviewCount: number;
  /** Tous statuts confondus — sinon un bien au contrôle n'apparaît nulle part. */
  totalCount: number;
  applicationCount: number;
  /** Coût mensuel courant : nombre de biens facturables × tarif du barème. */
  monthlyCostCents: number | null;
  subscriptionMonthlyCents: number | null;
}

/** Statuts pour lesquels l'abonnement est facturé : le bien est diffusé. */
const BILLABLE: PropertyStatus[] = [
  PropertyStatus.ONLINE,
  PropertyStatus.VISITS_IN_PROGRESS,
];

@Injectable()
export class OwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly saved: SavedService,
  ) {}

  /**
   * Ajoute une photo à un brouillon.
   *
   * Les photos d'annonce sont **publiques** : elles finiront affichées sur la
   * fiche, servies par un CDN. Rien à voir avec les pièces de dossier
   * locataire, qui restent privées (voir `StorageScope`).
   */
  async addPhoto(
    ownerId: string,
    reference: string,
    file: IncomingFile,
    caption?: string,
  ): Promise<{ id: string; url: string | null; position: number }> {
    const property = await this.ownedOrFail(ownerId, reference);

    if (property.status !== PropertyStatus.DRAFT) {
      throw new ConflictException(
        'Les photos ne se modifient que sur un brouillon. Retirez le bien de la publication.',
      );
    }

    const count = await this.prisma.propertyPhoto.count({
      where: { propertyId: property.id },
    });
    if (count >= MAX_PHOTOS) {
      throw new BadRequestException(`Maximum ${MAX_PHOTOS} photos par annonce.`);
    }

    const stored = await this.storage.save(
      'public',
      `properties/${reference.toLowerCase()}`,
      file,
      IMAGE_TYPES,
    );

    const photo = await this.prisma.propertyPhoto.create({
      data: {
        propertyId: property.id,
        storageKey: stored.key,
        caption: caption?.trim() || null,
        position: count,
      },
    });

    return {
      id: photo.id,
      url: this.storage.publicUrl('public', photo.storageKey),
      position: photo.position,
    };
  }

  /**
   * Retire une photo.
   *
   * L'enregistrement part d'abord, le fichier ensuite : si la suppression du
   * fichier échoue, il reste un orphelin sur le disque — gênant mais sans
   * conséquence. L'inverse laisserait une photo affichée pointant dans le vide.
   */
  async removePhoto(ownerId: string, reference: string, photoId: string): Promise<void> {
    const property = await this.ownedOrFail(ownerId, reference);

    if (property.status !== PropertyStatus.DRAFT) {
      throw new ConflictException('Les photos ne se modifient que sur un brouillon.');
    }

    const photo = await this.prisma.propertyPhoto.findFirst({
      where: { id: photoId, propertyId: property.id },
    });
    if (!photo) throw new NotFoundException('Photo introuvable.');

    await this.prisma.propertyPhoto.delete({ where: { id: photo.id } });
    await this.storage.remove('public', photo.storageKey);

    // Les positions restent contiguës, sinon l'ordre d'affichage se dégrade à
    // chaque suppression.
    const remaining = await this.prisma.propertyPhoto.findMany({
      where: { propertyId: property.id },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await this.prisma.$transaction(
      remaining.map((entry, index) =>
        this.prisma.propertyPhoto.update({
          where: { id: entry.id },
          data: { position: index },
        }),
      ),
    );
  }

  /**
   * Dépose un diagnostic.
   *
   * Régime **privé** : un diagnostic n'est pas une image d'annonce. Il est
   * annexé au bail et consulté par le propriétaire, l'agent qui contrôle et le
   * locataire signataire — jamais servi à un visiteur anonyme.
   *
   * Un seul document par type : redéposer remplace, et l'ancien fichier est
   * effacé. Empiler les versions laisserait l'agent contrôler un DPE périmé
   * sans savoir lequel fait foi.
   */
  async addDocument(
    ownerId: string,
    reference: string,
    type: PropertyDocumentType,
    file: IncomingFile,
    issuedAt?: string,
  ): Promise<{ id: string; type: PropertyDocumentType; status: DocumentStatus }> {
    const property = await this.ownedOrFail(ownerId, reference);

    if (property.status !== PropertyStatus.DRAFT) {
      throw new ConflictException(
        'Les diagnostics ne se modifient que sur un brouillon. Retirez le bien de la publication.',
      );
    }

    let issued: Date | undefined;
    if (issuedAt) {
      issued = new Date(issuedAt);
      if (Number.isNaN(issued.getTime())) {
        throw new BadRequestException('Date de réalisation invalide.');
      }
      if (issued.getTime() > Date.now()) {
        throw new BadRequestException(
          'La date de réalisation ne peut pas être dans le futur.',
        );
      }
    }

    const stored = await this.storage.save(
      'private',
      `properties/${reference.toLowerCase()}/diagnostics`,
      file,
      DOCUMENT_TYPES,
    );

    const previous = await this.prisma.propertyDocument.findFirst({
      where: { propertyId: property.id, type },
    });

    const document = previous
      ? await this.prisma.propertyDocument.update({
          where: { id: previous.id },
          data: {
            status: DocumentStatus.PENDING,
            fileName: file.originalname.slice(0, 200),
            mimeType: stored.mimeType,
            fileSize: stored.size,
            storageKey: stored.key,
            issuedAt: issued ?? null,
            rejectionReason: null,
            verificationNote: null,
          },
        })
      : await this.prisma.propertyDocument.create({
          data: {
            propertyId: property.id,
            type,
            fileName: file.originalname.slice(0, 200),
            mimeType: stored.mimeType,
            fileSize: stored.size,
            storageKey: stored.key,
            issuedAt: issued ?? null,
          },
        });

    if (previous) await this.storage.remove('private', previous.storageKey);

    return { id: document.id, type: document.type, status: document.status };
  }

  async removeDocument(ownerId: string, reference: string, documentId: string): Promise<void> {
    const property = await this.ownedOrFail(ownerId, reference);

    if (property.status !== PropertyStatus.DRAFT) {
      throw new ConflictException('Les diagnostics ne se modifient que sur un brouillon.');
    }

    const document = await this.prisma.propertyDocument.findFirst({
      where: { id: documentId, propertyId: property.id },
    });
    if (!document) throw new NotFoundException('Diagnostic introuvable.');

    await this.prisma.propertyDocument.delete({ where: { id: document.id } });
    await this.storage.remove('private', document.storageKey);
  }

  /**
   * Ouvre un diagnostic pour lecture.
   *
   * C'est ici que se joue le régime privé : le fichier ne sort que par cette
   * route, après vérification que le demandeur est bien le propriétaire du
   * bien. Aucune URL ne permet d'y accéder directement.
   */
  async readDocument(
    ownerId: string,
    reference: string,
    documentId: string,
  ): Promise<{ stream: Readable; mimeType: string; fileName: string }> {
    const property = await this.ownedOrFail(ownerId, reference);

    const document = await this.prisma.propertyDocument.findFirst({
      where: { id: documentId, propertyId: property.id },
    });
    if (!document) throw new NotFoundException('Diagnostic introuvable.');

    return {
      stream: await this.storage.read('private', document.storageKey),
      mimeType: document.mimeType ?? 'application/octet-stream',
      fileName: document.fileName ?? `${document.type.toLowerCase()}.pdf`,
    };
  }


  async listProperties(ownerId: string): Promise<OwnerPropertyItem[]> {
    const [properties, owner] = await Promise.all([
      this.prisma.property.findMany({
        where: { ownerId },
        include: {
          district: true,
          photos: { select: { id: true } },
          documents: { select: { type: true } },
          _count: { select: { applications: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
        select: { emailVerifiedAt: true },
      }),
    ]);

    // Le blocage tient au compte, pas au bien : il s'ajoute donc à chaque
    // ligne, pour que le propriétaire le voie là où il s'apprête à soumettre.
    const account = accountBlockers(owner);
    const saved = await this.saved.countsByProperty(properties.map((p) => p.id));

    return properties.map((property) => {
      const checks = propertyChecks(property);
      return {
        reference: property.reference,
        title: property.title,
        district: property.district.name,
        addressLine: property.addressLine,
        status: property.status,
        surfaceM2: property.surfaceM2,
        rooms: property.rooms,
        furnished: property.furnished,
        energyRating: property.energyRating,
        rentCents: property.rentCents,
        chargesCents: property.chargesCents,
        totalRentCents: property.rentCents + property.chargesCents,
        photoCount: property.photos.length,
        applicationCount: property._count.applications,
        savedCount: saved.get(property.id) ?? 0,
        publishedAt: property.publishedAt?.toISOString() ?? null,
        reviewNote: property.reviewNote,
        blockers: [...account, ...checks.blockers],
        warnings: checks.warnings,
      };
    });
  }

  /** Bien complet, tel que le formulaire de dépôt doit le repeupler. */
  async getForEdit(ownerId: string, reference: string): Promise<OwnerPropertyDetail> {
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { emailVerifiedAt: true },
    });
    await this.ownedOrFail(ownerId, reference);

    const property = await this.prisma.property.findFirstOrThrow({
      where: { reference, ownerId },
      include: {
        district: true,
        photos: { orderBy: { position: 'asc' } },
        documents: { orderBy: { type: 'asc' } },
        _count: { select: { applications: true } },
      },
    });

    return {
      reference: property.reference,
      title: property.title,
      description: property.description,
      addressLine: property.addressLine,
      districtSlug: property.district.slug,
      district: property.district.name,
      status: property.status,
      surfaceM2: property.surfaceM2,
      rooms: property.rooms,
      bedrooms: property.bedrooms,
      floor: property.floor,
      furnished: property.furnished,
      energyRating: property.energyRating,
      gesRating: property.gesRating,
      constructionYear: property.constructionYear,
      rentCents: property.rentCents,
      chargesCents: property.chargesCents,
      depositCents: property.depositCents,
      totalRentCents: property.rentCents + property.chargesCents,
      availableFrom: property.availableFrom?.toISOString() ?? null,
      availableImmediately: property.availableImmediately,
      minMonthlyIncomeCents: property.minMonthlyIncomeCents,
      guarantorRequirement: property.guarantorRequirement,
      acceptedContractTypes: property.acceptedContractTypes,
      photos: property.photos.map((photo) => ({
        id: photo.id,
        label: photo.caption ?? 'photo',
        url: this.storage.publicUrl('public', photo.storageKey),
      })),
      // Pas d'URL : un diagnostic ne sort que par la route de lecture contrôlée.
      documents: property.documents.map((document) => ({
        id: document.id,
        type: document.type,
        status: document.status,
        fileName: document.fileName,
        fileSize: document.fileSize,
        issuedAt: document.issuedAt?.toISOString() ?? null,
        rejectionReason: document.rejectionReason,
      })),
      photoCount: property.photos.length,
      applicationCount: property._count.applications,
      savedCount: (await this.saved.countsByProperty([property.id])).get(property.id) ?? 0,
      publishedAt: property.publishedAt?.toISOString() ?? null,
      reviewNote: property.reviewNote,
      ...(() => {
        const checks = propertyChecks(property);
        return {
          blockers: [...accountBlockers(owner), ...checks.blockers],
          warnings: checks.warnings,
        };
      })(),
    };
  }

  /**
   * Charge un bien en vérifiant qu'il appartient bien au demandeur.
   *
   * Un bien d'autrui renvoie 404, pas 403 : répondre « interdit » confirmerait
   * que la référence existe, et permettrait de balayer le portefeuille des
   * autres propriétaires.
   */
  private async ownedOrFail(ownerId: string, reference: string): Promise<Property> {
    const property = await this.prisma.property.findFirst({
      where: { reference, ownerId },
    });
    if (!property) {
      throw new NotFoundException(`Aucun bien ${reference} dans votre portefeuille.`);
    }
    return property;
  }

  /**
   * Référence suivante de la série, au format `MZ-0142` de la maquette.
   *
   * Le calcul est fait dans une transaction sérialisable : deux dépôts
   * simultanés produiraient sinon la même référence, et l'unicité en base
   * ferait échouer le second.
   */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const last = await tx.property.findFirst({
      where: { reference: { startsWith: 'MZ-' } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const current = last ? parseInt(last.reference.slice(3), 10) : 0;
    return `MZ-${String(current + 1).padStart(4, '0')}`;
  }

  /** Traduit le DTO en champs Prisma. Ne touche qu'aux champs fournis. */
  private async toData(dto: UpsertPropertyDto): Promise<Prisma.PropertyUpdateInput> {
    const data: Prisma.PropertyUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.addressLine !== undefined) data.addressLine = dto.addressLine;
    if (dto.surfaceM2 !== undefined) data.surfaceM2 = dto.surfaceM2;
    if (dto.rooms !== undefined) data.rooms = dto.rooms;
    if (dto.bedrooms !== undefined) data.bedrooms = dto.bedrooms;
    if (dto.floor !== undefined) data.floor = dto.floor || null;
    if (dto.energyRating !== undefined) data.energyRating = dto.energyRating;
    if (dto.gesRating !== undefined) data.gesRating = dto.gesRating;
    if (dto.constructionYear !== undefined) data.constructionYear = dto.constructionYear;
    if (dto.rentCents !== undefined) data.rentCents = dto.rentCents;
    if (dto.chargesCents !== undefined) data.chargesCents = dto.chargesCents;
    if (dto.minMonthlyIncomeCents !== undefined) {
      data.minMonthlyIncomeCents = dto.minMonthlyIncomeCents;
    }
    if (dto.guarantorRequirement !== undefined) {
      data.guarantorRequirement = dto.guarantorRequirement;
    }
    if (dto.acceptedContractTypes !== undefined) {
      data.acceptedContractTypes = dto.acceptedContractTypes;
    }

    // Le type de bail découle de l'ameublement : meublé → bail 1 an, nu →
    // bail 3 ans (loi du 6 juillet 1989). Il n'est jamais saisi à la main,
    // sinon les deux champs pourraient se contredire.
    if (dto.furnished !== undefined) {
      data.furnished = dto.furnished;
      data.leaseType = dto.furnished ? LeaseType.MEUBLE : LeaseType.NU;
      // Dépôt de garantie : 1 mois de loyer nu, 2 mois en meublé.
      const rent = dto.rentCents;
      if (rent !== undefined) data.depositCents = dto.furnished ? rent * 2 : rent;
    }

    if (dto.availableFrom !== undefined) {
      if (!dto.availableFrom) {
        data.availableFrom = null;
        data.availableImmediately = true;
      } else {
        const date = new Date(dto.availableFrom);
        if (Number.isNaN(date.getTime())) {
          throw new BadRequestException('Date de disponibilité invalide.');
        }
        data.availableFrom = date;
        data.availableImmediately = false;
      }
    }

    if (dto.districtSlug !== undefined) {
      const district = await this.prisma.district.findUnique({
        where: { slug: dto.districtSlug },
      });
      if (!district) throw new BadRequestException('Quartier inconnu.');
      data.district = { connect: { id: district.id } };
    }

    return data;
  }

  /** Crée un brouillon. Le bien n'est visible de personne d'autre à ce stade. */
  async createDraft(ownerId: string, dto: UpsertPropertyDto): Promise<{ reference: string }> {
    const data = await this.toData(dto);

    const property = await this.prisma.$transaction(
      async (tx) => {
        const reference = await this.nextReference(tx);
        const fallbackDistrict = await tx.district.findFirst({ orderBy: { position: 'asc' } });
        if (!fallbackDistrict) {
          throw new BadRequestException('Aucun quartier n’est configuré.');
        }

        // Valeurs de départ d'un brouillon vide, écrasées par ce que le
        // formulaire a déjà rempli. `energyRating` reste volontairement absent :
        // un brouillon sans DPE est un état légitime, et c'est ce qui rend le
        // blocage « DPE manquant » détectable.
        const defaults: Prisma.PropertyCreateInput = {
          reference,
          owner: { connect: { id: ownerId } },
          title: 'Nouveau bien',
          description: '',
          addressLine: '',
          district: { connect: { id: fallbackDistrict.id } },
          surfaceM2: 0,
          rooms: 1,
          leaseType: LeaseType.NU,
          rentCents: 0,
          chargesCents: 0,
          depositCents: 0,
          status: PropertyStatus.DRAFT,
        };

        return tx.property.create({
          data: { ...defaults, ...(data as Prisma.PropertyCreateInput) },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { reference: property.reference };
  }

  /**
   * Met à jour un brouillon.
   *
   * Un bien déjà en ligne n'est pas modifiable ici : changer la surface ou le
   * loyer d'une annonce publiée après réception de candidatures fausserait les
   * dossiers déjà transmis. Il faut le retirer d'abord.
   */
  async updateDraft(
    ownerId: string,
    reference: string,
    dto: UpsertPropertyDto,
  ): Promise<{ reference: string }> {
    const property = await this.ownedOrFail(ownerId, reference);

    if (property.status !== PropertyStatus.DRAFT) {
      throw new ConflictException(
        'Ce bien n’est plus un brouillon. Retirez-le de la publication pour le modifier.',
      );
    }

    const data = await this.toData(dto);
    await this.prisma.property.update({ where: { id: property.id }, data });
    return { reference: property.reference };
  }

  /**
   * Soumet le brouillon au contrôle de Bail (`DRAFT → PENDING_REVIEW`).
   *
   * La publication effective appartient au back-office (écran 14) : un
   * propriétaire ne met pas son annonce en ligne lui-même, elle est contrôlée
   * (diagnostics, cohérence surface/loyer) avant diffusion.
   */
  async submitForReview(ownerId: string, reference: string): Promise<{ status: PropertyStatus }> {
    const property = await this.ownedOrFail(ownerId, reference);

    if (property.status !== PropertyStatus.DRAFT) {
      throw new ConflictException('Seul un brouillon peut être soumis au contrôle.');
    }

    const [withFiles, owner] = await Promise.all([
      this.prisma.property.findUniqueOrThrow({
        where: { id: property.id },
        include: {
          photos: { select: { id: true } },
          documents: { select: { type: true } },
        },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
        select: { emailVerifiedAt: true },
      }),
    ]);

    // Une annonce diffusée engage des candidats : elle suppose qu'on puisse
    // joindre le bailleur. L'adresse confirmée est donc exigée ici, pas à la
    // création du brouillon.
    const blockers = [...accountBlockers(owner), ...propertyChecks(withFiles).blockers];
    if (blockers.length > 0) {
      // `statusCode` est repris explicitement : les autres exceptions Nest le
      // portent, et le front discrimine dessus.
      throw new BadRequestException({
        statusCode: 400,
        message: 'Ce bien ne peut pas encore être soumis au contrôle.',
        blockers,
      });
    }

    const updated = await this.prisma.property.update({
      where: { id: property.id },
      // Le motif du dernier renvoi s'efface à la resoumission : le garder
      // afficherait un reproche déjà traité.
      data: { status: PropertyStatus.PENDING_REVIEW, reviewNote: null },
    });

    return { status: updated.status };
  }

  /** Coordonnées du bailleur. Obligatoires au bail (loi n° 89-462, article 3). */
  async getProfile(ownerId: string): Promise<OwnerProfile> {
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { addressLine: true, postalCode: true, city: true },
    });
    return { ...owner, complete: isAddressComplete(owner) };
  }

  async updateProfile(
    ownerId: string,
    dto: UpdateOwnerProfileDto,
  ): Promise<OwnerProfile> {
    const owner = await this.prisma.user.update({
      where: { id: ownerId },
      data: {
        addressLine: dto.addressLine,
        postalCode: dto.postalCode,
        city: dto.city,
      },
      select: { addressLine: true, postalCode: true, city: true },
    });
    return { ...owner, complete: isAddressComplete(owner) };
  }

  async getSummary(ownerId: string): Promise<OwnerSummary> {
    const [properties, applicationCount, feeSchedule] = await Promise.all([
      this.prisma.property.findMany({ where: { ownerId }, select: { status: true } }),
      this.prisma.application.count({ where: { property: { ownerId } } }),
      this.prisma.feeSchedule.findFirst({
        where: { isActive: true },
        orderBy: { effectiveFrom: 'desc' },
        select: { ownerSubscriptionMonthlyCents: true },
      }),
    ]);

    const billable = properties.filter((p) => BILLABLE.includes(p.status)).length;
    const monthly = feeSchedule?.ownerSubscriptionMonthlyCents ?? null;

    const countOf = (status: PropertyStatus) =>
      properties.filter((p) => p.status === status).length;

    return {
      onlineCount: billable,
      draftCount: countOf(PropertyStatus.DRAFT),
      pendingReviewCount: countOf(PropertyStatus.PENDING_REVIEW),
      totalCount: properties.length,
      applicationCount,
      // Aucun montant en dur : le tarif vient du barème (docs/legal-context.md).
      // Un bien au contrôle n'est pas encore facturé : il n'est pas diffusé.
      monthlyCostCents: monthly === null ? null : billable * monthly,
      subscriptionMonthlyCents: monthly,
    };
  }
}
