import { Prisma } from '@prisma/client';

/**
 * Sélection Prisma servie par l'API publique des annonces.
 *
 * Volontairement restreinte : l'écran 1 du build-order est « consultable sans
 * compte », rien de nominatif sur le propriétaire ne doit sortir d'ici.
 */
export const propertyPublicInclude = {
  district: true,
  photos: { orderBy: { position: 'asc' } },
} satisfies Prisma.PropertyInclude;

export type PropertyWithRelations = Prisma.PropertyGetPayload<{
  include: typeof propertyPublicInclude;
}>;

export interface PropertyListItem {
  reference: string;
  title: string;
  district: { slug: string; name: string };
  addressLine: string;
  city: string;
  surfaceM2: number;
  rooms: number;
  floor: string | null;
  furnished: boolean;
  leaseType: string;
  energyRating: string;
  rentCents: number;
  chargesCents: number;
  /** Loyer charges comprises — la valeur affichée en gros sur la fiche. */
  totalRentCents: number;
  depositCents: number;
  availableFrom: string | null;
  availableImmediately: boolean;
  photoLabel: string;
  photoCount: number;
  status: string;
  publishedAt: string | null;
}

export interface PropertyDetail extends PropertyListItem {
  description: string;
  bedrooms: number | null;
  gesRating: string | null;
  constructionYear: number | null;
  photos: { label: string; storageKey: string }[];
  /**
   * Critères de sélection du propriétaire, tels qu'affichés dans le bloc
   * « CRITÈRES DU PROPRIÉTAIRE » de la fiche annonce.
   */
  ownerCriteria: {
    minMonthlyIncomeCents: number | null;
    guarantorRequirement: string;
    acceptedContractTypes: string[];
  };
  /** Durée légale du bail déduite du type de location (3 ans nu, 1 an meublé). */
  leaseDurationMonths: number;
}

const photoLabel = (property: PropertyWithRelations): string =>
  property.photos[0]?.caption ?? 'photo';

export function toListItem(property: PropertyWithRelations): PropertyListItem {
  return {
    reference: property.reference,
    title: property.title,
    district: { slug: property.district.slug, name: property.district.name },
    addressLine: property.addressLine,
    city: property.city,
    surfaceM2: property.surfaceM2,
    rooms: property.rooms,
    floor: property.floor,
    furnished: property.furnished,
    leaseType: property.leaseType,
    energyRating: property.energyRating,
    rentCents: property.rentCents,
    chargesCents: property.chargesCents,
    totalRentCents: property.rentCents + property.chargesCents,
    depositCents: property.depositCents,
    availableFrom: property.availableFrom?.toISOString() ?? null,
    availableImmediately: property.availableImmediately,
    photoLabel: photoLabel(property),
    photoCount: property.photos.length,
    status: property.status,
    publishedAt: property.publishedAt?.toISOString() ?? null,
  };
}

export function toDetail(property: PropertyWithRelations): PropertyDetail {
  return {
    ...toListItem(property),
    description: property.description,
    bedrooms: property.bedrooms,
    gesRating: property.gesRating,
    constructionYear: property.constructionYear,
    photos: property.photos.map((photo) => ({
      label: photo.caption ?? 'photo',
      storageKey: photo.storageKey,
    })),
    ownerCriteria: {
      minMonthlyIncomeCents: property.minMonthlyIncomeCents,
      guarantorRequirement: property.guarantorRequirement,
      acceptedContractTypes: property.acceptedContractTypes,
    },
    leaseDurationMonths: property.leaseType === 'MEUBLE' ? 12 : 36,
  };
}
