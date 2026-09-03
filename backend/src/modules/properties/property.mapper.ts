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
  /**
   * `null` seulement sur un brouillon : le DPE est obligatoire pour publier,
   * donc une annonce visible en porte toujours un. Le type reste honnête plutôt
   * que d'affirmer une garantie que la colonne ne donne pas.
   */
  energyRating: string | null;
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

/**
 * Honoraires à la charge du locataire pour ce bien précis.
 *
 * Calculés à partir du barème actif et de la surface habitable, jamais codés en
 * dur (docs/legal-context.md). `isLegallyApproved` est remonté tel quel : tant
 * qu'il est faux, l'interface doit présenter le montant comme provisoire plutôt
 * que comme un engagement.
 */
export interface TenantFees {
  totalCents: number;
  visitAndFileCents: number;
  inventoryCents: number;
  centsPerSqm: number;
  feeScheduleCode: string | null;
  isLegallyApproved: boolean;
}

export interface PropertyDetail extends PropertyListItem {
  description: string;
  bedrooms: number | null;
  gesRating: string | null;
  constructionYear: number | null;
  photos: { label: string; storageKey: string; url: string | null }[];
  /** `null` si aucun barème actif n'est publié — l'écran n'annonce alors rien. */
  tenantFees: TenantFees | null;
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

/** Barème actif, tel que lu en base. `null` si aucun n'est publié. */
export interface ActiveFeeSchedule {
  code: string;
  tenantVisitFeeCentsPerSqm: number;
  tenantInventoryFeeCentsPerSqm: number;
  isLegallyApproved: boolean;
}

function computeTenantFees(
  property: PropertyWithRelations,
  schedule: ActiveFeeSchedule | null,
): TenantFees | null {
  if (!schedule) return null;

  const visitAndFileCents = Math.round(property.surfaceM2 * schedule.tenantVisitFeeCentsPerSqm);
  const inventoryCents = Math.round(
    property.surfaceM2 * schedule.tenantInventoryFeeCentsPerSqm,
  );

  return {
    totalCents: visitAndFileCents + inventoryCents,
    visitAndFileCents,
    inventoryCents,
    centsPerSqm:
      schedule.tenantVisitFeeCentsPerSqm + schedule.tenantInventoryFeeCentsPerSqm,
    feeScheduleCode: schedule.code,
    isLegallyApproved: schedule.isLegallyApproved,
  };
}

/** Résout l'URL publique d'une clé de stockage. Injecté plutôt que reconstruit
 *  ici : la règle appartient au service de stockage, pas au mapper. */
export type PublicUrlResolver = (storageKey: string) => string | null;

export function toDetail(
  property: PropertyWithRelations,
  feeSchedule: ActiveFeeSchedule | null = null,
  publicUrl: PublicUrlResolver = () => null,
): PropertyDetail {
  return {
    ...toListItem(property),
    description: property.description,
    bedrooms: property.bedrooms,
    gesRating: property.gesRating,
    constructionYear: property.constructionYear,
    photos: property.photos.map((photo) => ({
      label: photo.caption ?? 'photo',
      storageKey: photo.storageKey,
      url: publicUrl(photo.storageKey),
    })),
    tenantFees: computeTenantFees(property, feeSchedule),
    ownerCriteria: {
      minMonthlyIncomeCents: property.minMonthlyIncomeCents,
      guarantorRequirement: property.guarantorRequirement,
      acceptedContractTypes: property.acceptedContractTypes,
    },
    leaseDurationMonths: property.leaseType === 'MEUBLE' ? 12 : 36,
  };
}
