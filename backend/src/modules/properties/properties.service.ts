import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
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
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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

  async search(query: SearchPropertiesDto): Promise<PropertySearchResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);

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

    const [total, properties] = await this.prisma.$transaction([
      this.prisma.property.count({ where }),
      this.prisma.property.findMany({
        where,
        include: propertyPublicInclude,
        orderBy: this.buildOrderBy(query.sort ?? PropertySort.COMPATIBILITY),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items: properties.map(toListItem), total, page, pageSize };
  }

  /** Bloc « Biens en avant à Metz » de la page d'accueil. */
  async findFeatured(limit = 3): Promise<PropertyListItem[]> {
    const properties = await this.prisma.property.findMany({
      where: visiblePropertyWhere(),
      include: propertyPublicInclude,
      orderBy: [{ publishedAt: 'desc' }, { reference: 'asc' }],
      take: limit,
    });
    return properties.map(toListItem);
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
