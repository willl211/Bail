import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { PublicUser } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { TenantService } from '../tenant/tenant.service';
import {
  canRankByCompatibility,
  compatibilityScore,
  type CompatibilityFile,
} from './compatibility';
import { VISIBLE_STATUSES, visiblePropertyWhere } from './property-visibility';
import {
  FurnishedFilter,
  PropertySort,
  SearchPropertiesDto,
} from './dto/search-properties.dto';
import {
  PropertyDetail,
  PropertyListItem,
  propertyPublicInclude,
  toDetail,
  toListItem,
} from './property.mapper';

export interface PropertySearchResult {
  items: PropertyListItem[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * Tri réellement appliqué.
   *
   * Peut différer de celui demandé : « compatibilité » retombe sur la récence
   * pour un visiteur sans dossier, faute de quoi la calculer. L'écran doit
   * pouvoir le dire plutôt que d'afficher une promesse non tenue.
   */
  sort: PropertySort;
}

/**
 * Au-delà de ce nombre d'annonces retenues, le classement par compatibilité
 * cède la place à la récence.
 *
 * La note dépend de celui qui regarde : aucune colonne ne la porte, il faut
 * charger et noter tout l'ensemble retenu à chaque recherche. C'est sans
 * conséquence sur le pilote messin — quelques dizaines d'annonces — et ce
 * serait déraisonnable sur dix mille. La borne rend la limite explicite plutôt
 * que de la laisser se découvrir un jour en production.
 */
const COMPATIBILITY_MAX_SET = 300;

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * Dossier du visiteur, s'il permet un classement par compatibilité.
   *
   * `null` couvre trois cas qui reviennent tous au même à l'écran : personne
   * n'est connecté, la personne connectée n'est pas locataire, ou son dossier
   * ne dit pas encore ses revenus. Le classement retombe alors sur la récence.
   */
  private async rankingFile(viewer: PublicUser | null): Promise<CompatibilityFile | null> {
    if (viewer?.role !== UserRole.TENANT) return null;
    const file = await this.tenant.compatibilitySummary(viewer.id);
    return canRankByCompatibility(file) ? file : null;
  }

  private buildWhere(query: SearchPropertiesDto): Prisma.PropertyWhereInput {
    const where: Prisma.PropertyWhereInput = visiblePropertyWhere();

    // Le filtre de loyer porte sur le loyer charges comprises, donc sur une
    // somme de deux colonnes : il est appliqué dans `search()` via une requête
    // SQL préalable, Prisma ne sachant pas comparer deux colonnes entre elles.

    if (query.minSurface) {
      where.surfaceM2 = { gte: query.minSurface };
    }

    if (query.minRooms || query.maxRooms) {
      where.rooms = {
        ...(query.minRooms ? { gte: query.minRooms } : {}),
        ...(query.maxRooms ? { lte: query.maxRooms } : {}),
      };
    }

    if (query.furnished && query.furnished !== FurnishedFilter.ALL) {
      where.furnished = query.furnished === FurnishedFilter.FURNISHED;
    }

    if (query.districts && query.districts.length > 0) {
      where.district = { slug: { in: query.districts } };
    }

    if (query.availableOnly) {
      where.OR = [
        { availableImmediately: true },
        { availableFrom: { lte: new Date() } },
      ];
    }

    return where;
  }

  private buildOrderBy(sort: PropertySort): Prisma.PropertyOrderByWithRelationInput[] {
    switch (sort) {
      case PropertySort.RENT_ASC:
        return [{ rentCents: 'asc' }, { reference: 'asc' }];
      case PropertySort.RENT_DESC:
        return [{ rentCents: 'desc' }, { reference: 'asc' }];
      case PropertySort.SURFACE_DESC:
        return [{ surfaceM2: 'desc' }, { reference: 'asc' }];
      case PropertySort.RECENT:
      case PropertySort.COMPATIBILITY:
      default:
        // Sans dossier locataire authentifié, « compatibilité » n'a pas de base
        // de calcul : on sert les annonces les plus récentes, de façon stable.
        return [{ publishedAt: 'desc' }, { reference: 'asc' }];
    }
  }

  async search(
    query: SearchPropertiesDto,
    viewer: PublicUser | null = null,
  ): Promise<PropertySearchResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);
    const asked = query.sort ?? PropertySort.COMPATIBILITY;

    // Le filtre « loyer charges comprises » porte sur une somme de colonnes :
    // on restreint d'abord l'ensemble des identifiants avec une requête SQL,
    // puis on laisse Prisma gérer le reste des filtres et la pagination.
    if (query.maxRent !== undefined || query.minRent !== undefined) {
      const max = query.maxRent !== undefined ? query.maxRent * 100 : Number.MAX_SAFE_INTEGER;
      const min = query.minRent !== undefined ? query.minRent * 100 : 0;
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM properties
        WHERE ("rentCents" + "chargesCents") BETWEEN ${min} AND ${max}
      `;
      where.id = { in: rows.map((row) => row.id) };
    }

    const total = await this.prisma.property.count({ where });

    if (asked === PropertySort.COMPATIBILITY && total <= COMPATIBILITY_MAX_SET) {
      const file = await this.rankingFile(viewer);
      if (file) {
        // Le tri se fait en mémoire : la note dépend du dossier de celui qui
        // regarde, elle n'existe donc dans aucune colonne. Toutes les annonces
        // retenues sont chargées, notées, triées, puis découpées en pages —
        // trier page par page ne trierait rien du tout.
        const all = await this.prisma.property.findMany({
          where,
          include: propertyPublicInclude,
          orderBy: this.buildOrderBy(PropertySort.RECENT),
        });

        const ranked = all
          .map((property) => ({ property, score: compatibilityScore(property, file) }))
          // À note égale, l'ordre de la récence : `sort` est stable, la liste
          // arrive déjà dans cet ordre, il suffit de ne pas le défaire.
          .sort((a, b) => b.score - a.score)
          .slice((page - 1) * pageSize, page * pageSize)
          .map((entry) => toListItem(entry.property));

        return {
          items: ranked,
          total,
          page,
          pageSize,
          sort: PropertySort.COMPATIBILITY,
        };
      }
    }

    // Sans dossier exploitable, « compatibilité » n'a pas de base de calcul :
    // on sert la récence, et on le dit.
    const applied = asked === PropertySort.COMPATIBILITY ? PropertySort.RECENT : asked;

    const properties = await this.prisma.property.findMany({
      where,
      include: propertyPublicInclude,
      orderBy: this.buildOrderBy(applied),
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items: properties.map(toListItem), total, page, pageSize, sort: applied };
  }

  /** Bloc « Biens en avant à Metz » de la page d'accueil. */
  /**
   * « Biens en avant » de l'accueil.
   *
   * Pour un locataire dont le dossier dit ses revenus, ce sont les logements
   * les plus à sa portée ; pour tout le monde d'autre, les plus récents. Pas de
   * classement par nombre de sauvegardes : il s'auto-entretient — une annonce
   * nouvelle en a zéro, donc ne remonte jamais, donc n'en obtient jamais
   * (docs/product-brief.md).
   */
  async findFeatured(limit = 3, viewer: PublicUser | null = null): Promise<PropertyListItem[]> {
    const recents = await this.prisma.property.findMany({
      where: visiblePropertyWhere(),
      include: propertyPublicInclude,
      orderBy: [{ publishedAt: 'desc' }, { reference: 'asc' }],
      // Toutes les annonces visibles, pas seulement `limit` : les trois plus
      // récentes ne sont pas les trois plus compatibles, et n'en garder que
      // trois avant de noter reviendrait à classer ce qu'on a déjà choisi.
      take: COMPATIBILITY_MAX_SET,
    });

    const file = await this.rankingFile(viewer);
    if (!file) return recents.slice(0, limit).map(toListItem);

    // Notés une fois chacun, puis triés : calculer la note dans le comparateur
    // la recalculerait à chaque comparaison.
    return recents
      .map((property) => ({ property, score: compatibilityScore(property, file) }))
      // À note égale, l'ordre de la récence : `sort` est stable.
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => toListItem(entry.property));
  }

  async findByReference(reference: string): Promise<PropertyDetail> {
    // Le barème est lu en même temps que le bien : les honoraires locataire
    // sont annoncés sur la fiche, avant toute candidature, et dépendent de la
    // surface habitable. Ils ne sont jamais codés en dur.
    const [property, feeSchedule] = await Promise.all([
      this.prisma.property.findFirst({
        where: { reference, status: { in: VISIBLE_STATUSES } },
        include: propertyPublicInclude,
      }),
      this.prisma.feeSchedule.findFirst({
        where: { isActive: true },
        orderBy: { effectiveFrom: 'desc' },
        select: {
          code: true,
          tenantVisitFeeCentsPerSqm: true,
          tenantInventoryFeeCentsPerSqm: true,
          isLegallyApproved: true,
        },
      }),
    ]);

    if (!property) {
      throw new NotFoundException(`Aucune annonce en ligne pour la référence ${reference}`);
    }

    return toDetail(property, feeSchedule, (key) => this.storage.publicUrl('public', key));
  }
}
