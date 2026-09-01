import { Prisma, PropertyStatus } from '@prisma/client';

/**
 * Ce qui rend une annonce visible du public.
 *
 * Un bien reste consultable pendant les visites : il ne disparaît qu'une fois
 * loué ou archivé. Définition unique, partagée par la recherche, le référentiel
 * des quartiers et les indicateurs de marché — trois endroits qui doivent
 * compter exactement les mêmes biens.
 */
export const VISIBLE_STATUSES: PropertyStatus[] = [
  PropertyStatus.ONLINE,
  PropertyStatus.VISITS_IN_PROGRESS,
];

export const visiblePropertyWhere = (): Prisma.PropertyWhereInput => ({
  status: { in: VISIBLE_STATUSES },
  publishedAt: { not: null },
});
