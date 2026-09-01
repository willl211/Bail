/**
 * Accès à l'API NestJS depuis les composants serveur.
 *
 * `API_INTERNAL_URL` est l'URL vue depuis le serveur Next (identique à
 * `NEXT_PUBLIC_API_URL` en local, différente une fois conteneurisé).
 */

const API_URL =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
      // Les annonces changent au fil des dépôts propriétaires : on ne met pas
      // en cache tant qu'il n'y a pas d'invalidation côté back-office.
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      `API injoignable (${url}). Le backend est-il démarré ?`,
      0,
      url,
    );
  }

  if (response.status === 404) {
    throw new ApiError('Ressource introuvable', 404, url);
  }

  if (!response.ok) {
    throw new ApiError(`Réponse ${response.status} de l'API`, response.status, url);
  }

  return (await response.json()) as T;
}

// -----------------------------------------------------------------------------
// Types miroir des réponses de l'API (backend/src/modules/*)
// -----------------------------------------------------------------------------

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
  leaseType: 'NU' | 'MEUBLE';
  energyRating: string;
  rentCents: number;
  chargesCents: number;
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
  ownerCriteria: {
    minMonthlyIncomeCents: number | null;
    guarantorRequirement: string;
    acceptedContractTypes: string[];
  };
  leaseDurationMonths: number;
}

export interface PropertySearchResult {
  items: PropertyListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface District {
  slug: string;
  name: string;
  city: string;
  availableCount: number;
}

export interface MarketMetric {
  key: string;
  label: string;
  value: string;
  source: 'computed' | 'setting';
}

export interface MarketSnapshot {
  verifiedPropertyCount: number;
  metrics: MarketMetric[];
}

export interface OwnerSubscriptionPricing {
  monthlyAmountCents: number | null;
  feeScheduleCode: string | null;
  isLegallyApproved: boolean;
}

// -----------------------------------------------------------------------------
// Appels
// -----------------------------------------------------------------------------

export function getFeaturedProperties(limit = 3) {
  return apiFetch<PropertyListItem[]>(`/properties/featured?limit=${limit}`);
}

export function searchProperties(params: URLSearchParams) {
  const query = params.toString();
  return apiFetch<PropertySearchResult>(`/properties${query ? `?${query}` : ''}`);
}

export function getProperty(reference: string) {
  return apiFetch<PropertyDetail>(`/properties/${encodeURIComponent(reference)}`);
}

export function getDistricts() {
  return apiFetch<District[]>('/districts');
}

export function getMarketSnapshot() {
  return apiFetch<MarketSnapshot>('/market/snapshot');
}

export function getOwnerSubscriptionPricing() {
  return apiFetch<OwnerSubscriptionPricing>('/market/owner-subscription');
}
