import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, PropertyStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT } from '../mail/event.templates';
import { MailService } from '../mail/mail.service';
import { StorageService } from '../storage/storage.service';

/**
 * Biens sauvegardés par un locataire.
 *
 * Un bien loué ou retiré **reste** dans la liste, avec son statut : le faire
 * disparaître sans explication laisserait le locataire croire à un défaut, et
 * le priverait de l'information qui compte — ce logement n'est plus à prendre.
 */
export interface SavedPropertyItem {
  reference: string;
  title: string;
  district: string;
  surfaceM2: number;
  rooms: number;
  furnished: boolean;
  energyRating: string | null;
  totalRentCents: number;
  photoUrl: string | null;
  status: PropertyStatus;
  /** Vrai tant que le bien accepte des candidatures. */
  available: boolean;
  savedAt: string;
}

/** Statuts pour lesquels une candidature est encore possible. */
const OPEN_STATUSES: PropertyStatus[] = [
  PropertyStatus.ONLINE,
  PropertyStatus.VISITS_IN_PROGRESS,
];

@Injectable()
export class SavedService {
  private readonly logger = new Logger(SavedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}

  /**
   * Bien sauvegardable, par sa référence.
   *
   * Un brouillon n'est pas sauvegardable : il n'a jamais été visible
   * publiquement, et répondre autre chose que 404 confirmerait son existence à
   * qui devine une référence.
   */
  private async savableOrFail(
    reference: string,
  ): Promise<{ id: string; rentCents: number; chargesCents: number }> {
    const property = await this.prisma.property.findFirst({
      where: { reference, publishedAt: { not: null } },
      select: { id: true, rentCents: true, chargesCents: true },
    });
    if (!property) throw new NotFoundException('Ce bien n’existe pas.');
    return property;
  }

  /** Sauvegarde. Idempotent : sauvegarder deux fois n'est pas une erreur. */
  async save(tenantId: string, reference: string): Promise<{ saved: true }> {
    const property = await this.savableOrFail(reference);

    try {
      await this.prisma.savedProperty.create({
        data: {
          tenantId,
          propertyId: property.id,
          // Le loyer d'aujourd'hui devient le point de comparaison d'une
          // éventuelle baisse : c'est ce prix-là que cette personne a vu.
          rentCentsAtSave: property.rentCents + property.chargesCents,
        },
      });
    } catch (error) {
      // La contrainte d'unicité fait le travail : un double clic, ou deux
      // onglets ouverts sur la même fiche, ne doivent pas produire d'erreur.
      const dejaSauvegarde =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!dejaSauvegarde) throw error;
    }

    return { saved: true };
  }

  /** Retire de la liste. Idempotent également. */
  async unsave(tenantId: string, reference: string): Promise<{ saved: false }> {
    const property = await this.savableOrFail(reference);
    await this.prisma.savedProperty.deleteMany({
      where: { tenantId, propertyId: property.id },
    });
    return { saved: false };
  }

  /**
   * Références sauvegardées, pour marquer les cartes d'une page de résultats.
   *
   * Une seule requête plutôt qu'un champ ajouté à chaque bien : les routes
   * publiques d'annonces restent publiques et sans état, et le front n'a qu'à
   * croiser deux listes.
   */
  async references(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.savedProperty.findMany({
      where: { tenantId },
      select: { property: { select: { reference: true } } },
    });
    return rows.map((row) => row.property.reference);
  }

  async list(tenantId: string): Promise<SavedPropertyItem[]> {
    const rows = await this.prisma.savedProperty.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        property: {
          include: {
            district: { select: { name: true } },
            photos: { orderBy: { position: 'asc' }, take: 1 },
          },
        },
      },
    });

    return rows.map(({ property, createdAt }) => ({
      reference: property.reference,
      title: property.title,
      district: property.district.name,
      surfaceM2: property.surfaceM2,
      rooms: property.rooms,
      furnished: property.furnished,
      energyRating: property.energyRating,
      totalRentCents: property.rentCents + property.chargesCents,
      photoUrl: property.photos[0]
        ? this.storage.publicUrl('public', property.photos[0].storageKey)
        : null,
      status: property.status,
      available: OPEN_STATUSES.includes(property.status),
      savedAt: createdAt.toISOString(),
    }));
  }

  /**
   * Locataires à prévenir d'un événement sur un bien qu'ils suivent.
   *
   * Ceux qui ont candidaté sur ce bien en sont exclus : ils reçoivent déjà les
   * messages de leur candidature, et l'événement leur y est annoncé sous
   * l'angle qui les concerne. Leur écrire une seconde fois à propos du même
   * fait ferait de la notification un bruit plutôt qu'une information.
   */
  private async followersToNotify(propertyId: string, where: Prisma.SavedPropertyWhereInput) {
    const candidats = await this.prisma.application.findMany({
      where: { propertyId },
      select: { tenantId: true },
    });
    const dejaEnCours = candidats.map((candidat) => candidat.tenantId);

    return this.prisma.savedProperty.findMany({
      where: { ...where, propertyId, tenantId: { notIn: dejaEnCours } },
      select: { tenantId: true, rentCentsAtSave: true },
    });
  }

  /**
   * Signale une baisse de loyer à ceux qui suivent le bien.
   *
   * Appelée à la (re)publication : un bien en ligne ne se modifie pas, il
   * repasse en brouillon, est corrigé, puis repasse au contrôle. C'est donc au
   * moment où il redevient visible que la baisse devient réelle.
   *
   * Seuls sont prévenus ceux dont le loyer de référence est plus élevé que le
   * loyer courant. Une hausse ne se notifie pas : personne n'a demandé à être
   * prévenu qu'un logement s'éloignait de lui.
   */
  async notifyPriceDrop(propertyId: string): Promise<number> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { rentCents: true, chargesCents: true },
    });
    if (!property) return 0;

    const actuel = property.rentCents + property.chargesCents;
    const suiveurs = await this.followersToNotify(propertyId, {
      rentCentsAtSave: { gt: actuel },
    });

    for (const suiveur of suiveurs) {
      await this.mail.enqueue({
        template: EVENT.savedPropertyPriceDrop,
        userId: suiveur.tenantId,
        subjectRef: propertyId,
        // Une baisse par palier de prix : si le loyer rebaisse plus tard, la
        // clé change et le message repart. S'il repasse deux fois par le même
        // prix, il ne se redit pas.
        dedupeKey: `${EVENT.savedPropertyPriceDrop}:${propertyId}:${actuel}:${suiveur.tenantId}`,
      });
    }

    if (suiveurs.length > 0) {
      this.logger.log(`Baisse de loyer signalée à ${suiveurs.length} locataire(s).`);
    }
    return suiveurs.length;
  }

  /** Signale que le bien suivi est loué. Une fois, définitivement. */
  async notifyRented(propertyId: string): Promise<number> {
    const suiveurs = await this.followersToNotify(propertyId, {});

    for (const suiveur of suiveurs) {
      await this.mail.enqueue({
        template: EVENT.savedPropertyRented,
        userId: suiveur.tenantId,
        subjectRef: propertyId,
        dedupeKey: `${EVENT.savedPropertyRented}:${propertyId}:${suiveur.tenantId}`,
      });
    }

    if (suiveurs.length > 0) {
      this.logger.log(`Bien loué signalé à ${suiveurs.length} locataire(s).`);
    }
    return suiveurs.length;
  }

  /**
   * Nombre de locataires ayant sauvegardé chacun des biens demandés.
   *
   * Servi au propriétaire du bien et au back-office, **jamais** aux autres
   * locataires : un compteur public découragerait des candidats sur un marché
   * déjà tendu (6,8 candidatures par bien à Metz), et concentrerait les
   * candidatures sur les mêmes annonces.
   *
   * Agrégat seulement : le propriétaire ne voit jamais **qui** a sauvegardé,
   * comme il ne voit jamais les pièces d'un dossier.
   */
  async countsByProperty(propertyIds: string[]): Promise<Map<string, number>> {
    if (propertyIds.length === 0) return new Map();

    const rows = await this.prisma.savedProperty.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: propertyIds } },
      _count: { propertyId: true },
    });

    return new Map(rows.map((row) => [row.propertyId, row._count.propertyId]));
  }
}
