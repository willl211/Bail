import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { visiblePropertyWhere } from '../properties/property-visibility';

export interface DistrictWithCount {
  slug: string;
  name: string;
  city: string;
  availableCount: number;
}

@Injectable()
export class DistrictsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quartiers de la zone pilote, avec le nombre d'annonces visibles — c'est le
   * compteur affiché à droite de chaque case à cocher du panneau de filtres.
   */
  async findAllWithCounts(): Promise<DistrictWithCount[]> {
    const districts = await this.prisma.district.findMany({
      orderBy: { position: 'asc' },
      include: {
        _count: {
          select: {
            properties: { where: visiblePropertyWhere() },
          },
        },
      },
    });

    return districts.map((district) => ({
      slug: district.slug,
      name: district.name,
      city: district.city,
      availableCount: district._count.properties,
    }));
  }
}
