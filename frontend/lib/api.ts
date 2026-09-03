/**
 * Accès à l'API NestJS depuis les composants serveur.
 *
 * `API_INTERNAL_URL` est l'URL vue depuis le serveur Next (identique à
 * `NEXT_PUBLIC_API_URL` en local, différente une fois conteneurisé).
 */
import { cookies } from 'next/headers';

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

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Appel authentifié depuis un composant serveur.
 *
 * Le navigateur envoie le cookie de session à Next, pas à l'API : sans ce
 * relais explicite, une page rendue côté serveur interrogerait l'API en
 * anonyme et recevrait un 401 alors que l'utilisateur est connecté.
 */
export async function apiFetchAuthed<T>(path: string, init?: RequestInit): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  return apiFetch<T>(path, {
    ...init,
    headers: { ...init?.headers, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
  });
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
  /** `null` uniquement sur un brouillon : publier exige un DPE. */
  energyRating: string | null;
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

/**
 * Honoraires à la charge du locataire, calculés par l'API depuis le barème
 * actif et la surface du bien. `isLegallyApproved` doit être affiché : tant
 * qu'il est faux, le montant est provisoire (docs/legal-context.md).
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
  tenantFees: TenantFees | null;
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

// -----------------------------------------------------------------------------
// Authentification et espace propriétaire
// -----------------------------------------------------------------------------

export type UserRole = 'OWNER' | 'TENANT' | 'AGENT';

export interface CurrentUser {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone: string | null;
  createdAt: string;
}

/**
 * Profil courant, ou `null` si personne n'est connecté.
 *
 * Ne lève jamais : « pas de session » est une réponse normale, pas une erreur.
 * Une API injoignable ne doit pas non plus faire tomber une page publique.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const { user } = await apiFetchAuthed<{ user: CurrentUser | null }>('/auth/me');
    return user;
  } catch {
    return null;
  }
}

export type PropertyStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ONLINE'
  | 'VISITS_IN_PROGRESS'
  | 'RENTED'
  | 'ARCHIVED';

export interface OwnerProperty {
  reference: string;
  title: string;
  district: string;
  addressLine: string;
  status: PropertyStatus;
  surfaceM2: number;
  rooms: number;
  furnished: boolean;
  energyRating: string | null;
  rentCents: number;
  chargesCents: number;
  totalRentCents: number;
  photoCount: number;
  applicationCount: number;
  publishedAt: string | null;
  /** Ce qui empêche la soumission au contrôle. */
  blockers: string[];
  /** Ce qui la dessert sans l'empêcher. */
  warnings: string[];
}

export interface OwnerSummary {
  onlineCount: number;
  draftCount: number;
  /** Soumis au contrôle : ni brouillon, ni encore diffusé. */
  pendingReviewCount: number;
  totalCount: number;
  applicationCount: number;
  monthlyCostCents: number | null;
  subscriptionMonthlyCents: number | null;
}

/** Bien complet, tel que le formulaire de dépôt le repeuple. */
export interface OwnerPropertyDetail extends Omit<OwnerProperty, 'district'> {
  description: string;
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
    type: 'DPE' | 'ASBESTOS' | 'LEAD' | 'ERP' | 'ELECTRICAL' | 'GAS' | 'OTHER';
    status: string;
    fileName: string | null;
    fileSize: number | null;
    issuedAt: string | null;
    rejectionReason: string | null;
  }[];
}

export function getOwnerProperties() {
  return apiFetchAuthed<OwnerProperty[]>('/owner/properties');
}

export function getOwnerProperty(reference: string) {
  return apiFetchAuthed<OwnerPropertyDetail>(
    `/owner/properties/${encodeURIComponent(reference)}`,
  );
}

export function getOwnerSummary() {
  return apiFetchAuthed<OwnerSummary>('/owner/summary');
}

// --- Abonnement propriétaire -------------------------------------------------

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED';

export interface SubscriptionLine {
  reference: string;
  label: string;
  billed: boolean;
  amountCents: number;
  statusLabel: string;
}

export interface SubscriptionInvoice {
  id: string;
  reference: string;
  period: string;
  propertyCount: number;
  amountCents: number;
  status: PaymentStatus;
  paidAt: string | null;
}

export interface SubscriptionBenchmark {
  monthlyRentCents: number;
  lettingsPerYear: number;
  agencyYearlyCents: number;
  mandateYearlyCents: number;
  platformYearlyCents: number;
  agencyLettingFeeMonths: number;
  mandateRate: number;
}

export interface SubscriptionOverview {
  status: SubscriptionStatus | null;
  planLabel: string;
  unitAmountCents: number | null;
  feeScheduleCode: string | null;
  feeScheduleApproved: boolean;
  billableCount: number;
  monthlyTotalCents: number;
  nextChargeAt: string | null;
  cancelledAt: string | null;
  lines: SubscriptionLine[];
  invoices: SubscriptionInvoice[];
  benchmark: SubscriptionBenchmark | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expiry: string;
    holder: string;
    /** Vrai avec le driver simulé : aucune carte réelle n'est enregistrée. */
    simulated: boolean;
  } | null;
  driver: string;
}

export function getSubscription() {
  return apiFetchAuthed<SubscriptionOverview>('/owner/subscription');
}

// --- Candidatures reçues (espace propriétaire) -------------------------------

export type ApplicationStatus =
  | 'SUBMITTED'
  | 'READ'
  | 'SHORTLISTED'
  | 'VISIT_SCHEDULED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'EXPIRED';

export type TenantFileStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'INCOMPLETE'
  | 'REJECTED';

export interface ApplicationTile {
  reference: string;
  title: string;
  district: string;
  status: PropertyStatus;
  open: boolean;
  applicationCount: number;
  totalRentCents: number;
  rooms: number;
  furnished: boolean;
  hint: string | null;
  publishedAt: string | null;
}

export interface OwnerApplication {
  id: string;
  propertyReference: string;
  propertyTitle: string;
  tenantName: string;
  tenantInitials: string;
  fileReference: string;
  fileStatus: TenantFileStatus;
  netMonthlyIncomeCents: number | null;
  contractType: string | null;
  employerName: string | null;
  identityVerified: boolean;
  message: string | null;
  /** Loyer charges comprises sur revenus nets vérifiés. */
  effortRate: number | null;
  guarantorLabel: string | null;
  verifiedDocumentCount: number;
  documentCount: number;
  status: ApplicationStatus;
  submittedAt: string;
}

export interface OwnerApplicationsView {
  newCount: number;
  underReviewCount: number;
  visitsScheduledCount: number;
  averageResponseHours: number | null;
  tiles: ApplicationTile[];
  applications: OwnerApplication[];
}

export function getOwnerApplications() {
  return apiFetchAuthed<OwnerApplicationsView>('/owner/applications');
}

// --- Dossier locataire -------------------------------------------------------

export type DocumentStatus =
  | 'MISSING'
  | 'PENDING'
  | 'PROCESSING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export type DocumentType =
  | 'ID_CARD'
  | 'PASSPORT'
  | 'PAYSLIP'
  | 'EMPLOYMENT_CONTRACT'
  | 'TAX_NOTICE'
  | 'PROOF_OF_ADDRESS'
  | 'STUDENT_CARD'
  | 'GUARANTOR_ID'
  | 'GUARANTOR_INCOME'
  | 'OTHER';

export type DocumentGroup = 'identity' | 'income' | 'housing' | 'guarantor';

export type EmploymentContractType =
  | 'CDI'
  | 'CDD'
  | 'PUBLIC_SECTOR'
  | 'SELF_EMPLOYED'
  | 'STUDENT'
  | 'RETIRED'
  | 'OTHER';

export type GuarantorKind = 'INDIVIDUAL' | 'ORGANISATION';

export interface TenantDocumentView {
  id: string;
  /** Faux pour une pièce enregistrée sans fichier : rien à ouvrir. */
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  status: DocumentStatus;
  verificationNote: string | null;
  rejectionReason: string | null;
  uploadedAt: string;
}

export interface TenantSlotView {
  type: DocumentType;
  label: string;
  hint: string;
  group: DocumentGroup;
  max: number;
  required: boolean;
  status: DocumentStatus;
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
  incomeVerified: boolean;
  maxRentCents: number | null;
  verifiedSlotCount: number;
  expectedSlotCount: number;
  /** Ce que le locataire doit faire : bloque la transmission. */
  missing: string[];
  /** Pièces en cours de contrôle : informatif, ne bloque rien. */
  awaiting: string[];
  groups: Record<DocumentGroup, DocumentStatus>;
  slots: TenantSlotView[];
  guarantor: TenantGuarantorView | null;
  journal: TenantJournalEntry[];
  submittedAt: string | null;
  verifiedAt: string | null;
  /** `mock` tant qu'aucun prestataire de vérification n'est retenu. */
  verificationDriver: string;
}

export function getTenantFile() {
  return apiFetchAuthed<TenantFileView>('/tenant/file');
}

// --- Candidature à un bien ---------------------------------------------------

export interface CandidacyPropertySummary {
  reference: string;
  title: string;
  district: string;
  addressLine: string;
  city: string;
  surfaceM2: number;
  rooms: number;
  energyRating: string | null;
  totalRentCents: number;
  photoLabel: string;
  photoUrl: string | null;
  applicationCount: number;
}

export interface CandidacyFileSummary {
  holderName: string;
  contractType: EmploymentContractType | null;
  netMonthlyIncomeCents: number | null;
  incomeVerified: boolean;
  guarantor: { label: string; verified: boolean } | null;
}

export interface TenantFeesQuote {
  totalCents: number;
  visitAndFileCents: number;
  inventoryCents: number;
  centsPerSqm: number;
  feeScheduleCode: string | null;
  isLegallyApproved: boolean;
}

export interface CandidacyPreview {
  property: CandidacyPropertySummary;
  fees: TenantFeesQuote | null;
  effortRate: number | null;
  file: CandidacyFileSummary;
  blockers: string[];
  warnings: string[];
  alreadyApplied: boolean;
  applicationStatus: ApplicationStatus | null;
  averageResponseDelay: string | null;
}

export interface TenantApplicationSummary {
  id: string;
  propertyReference: string;
  propertyTitle: string;
  district: string;
  totalRentCents: number;
  submittedAt: string;
  status: ApplicationStatus;
  stepLabel: string;
}

export function getCandidacyPreview(reference: string) {
  return apiFetchAuthed<CandidacyPreview>(
    `/tenant/applications/${encodeURIComponent(reference)}/preview`,
  );
}

export function getTenantApplications() {
  return apiFetchAuthed<TenantApplicationSummary[]>('/tenant/applications');
}

// --- Visites -----------------------------------------------------------------

export type VisitType = 'ACCOMPANIED' | 'VIDEO';

export type VisitStatus =
  | 'REQUESTED'
  | 'PENDING_CHECKS'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type PreauthorizationStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'AUTHORIZED'
  | 'FAILED'
  | 'RELEASED'
  | 'CAPTURED';

export interface BookableSlot {
  id: string;
  startsAt: string;
  durationMinutes: number;
  allowedTypes: VisitType[];
}

export interface VisitView {
  id: string;
  propertyReference: string;
  propertyTitle: string;
  addressLine: string;
  district: string;
  type: VisitType;
  status: VisitStatus;
  scheduledAt: string;
  durationMinutes: number;
  agentName: string | null;
  videoRoomUrl: string | null;
  preauthorizationStatus: PreauthorizationStatus;
  preauthorizationAmountCents: number | null;
  cancellable: boolean;
}

export interface VisitPrerequisite {
  key: 'identity' | 'preauthorization' | 'camera';
  label: string;
  detail: string;
  state: 'ok' | 'pending' | 'info';
  blocking: boolean;
}

export interface VisitBookingView {
  property: {
    reference: string;
    title: string;
    addressLine: string;
    district: string;
  };
  applicationStatus: ApplicationStatus | null;
  blockers: string[];
  prerequisites: VisitPrerequisite[];
  slots: BookableSlot[];
  visit: VisitView | null;
  durations: Record<VisitType, number>;
  cancellationDeadlineHours: number;
  recordingRetentionDays: number;
  /** `mock` tant qu'aucun prestataire n'est branché. */
  drivers: { video: string; payment: string };
}

/** Créneau tel que son propriétaire le voit. */
export interface OwnerSlotView {
  id: string;
  startsAt: string;
  durationMinutes: number;
  allowedTypes: VisitType[];
  booked: boolean;
  bookedBy: string | null;
  visitStatus: VisitStatus | null;
  past: boolean;
}

export function getVisitBookingView(reference: string) {
  return apiFetchAuthed<VisitBookingView>(
    `/tenant/visits/property/${encodeURIComponent(reference)}`,
  );
}

export function getTenantVisits() {
  return apiFetchAuthed<VisitView[]>('/tenant/visits');
}

export function getOwnerSlots(reference: string) {
  return apiFetchAuthed<OwnerSlotView[]>(
    `/owner/properties/${encodeURIComponent(reference)}/slots`,
  );
}

// --- Bail et signature -------------------------------------------------------

export type LeaseStatus =
  | 'DRAFT'
  | 'FIELDS_VALIDATED'
  | 'SENT_FOR_SIGNATURE'
  | 'PARTIALLY_SIGNED'
  | 'SIGNED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface RenderedSegment {
  text: string;
  /** Nom du champ quand le fragment est une valeur injectée. */
  field: string | null;
}

export interface RenderedBlock {
  heading: number;
  segments: RenderedSegment[];
}

export interface LeaseCheck {
  key: string;
  label: string;
  detail: string;
  source: string;
  status: 'CONFORME' | 'ANOMALIE' | 'NON_VERIFIABLE';
  message: string | null;
}

export interface LeaseValidationReport {
  checks: LeaseCheck[];
  anomalies: string[];
  unverifiable: string[];
  fieldCount: number;
  missingFields: string[];
  validatedAt: string;
}

export interface LeaseView {
  reference: string;
  status: LeaseStatus;
  type: 'NU' | 'MEUBLE';
  propertyReference: string;
  propertyTitle: string;
  addressLine: string;
  templateLabel: string;
  templateCode: string;
  templateVersion: number;
  templatePublished: boolean;
  startDate: string;
  endDate: string;
  durationMonths: number;
  rentCents: number;
  chargesCents: number;
  depositCents: number;
  document: RenderedBlock[];
  validation: LeaseValidationReport | null;
  signers: { role: 'LANDLORD' | 'TENANT'; fullName: string; signed: boolean; signedAt: string | null }[];
  annexes: { type: string; label: string; present: boolean; detail: string }[];
  history: { at: string; tone: 'ok' | 'pending' | 'reject' | 'neutral'; title: string; note: string }[];
  blockers: string[];
  signatureDriver: string;
  sentForSignatureAt: string | null;
  signedAt: string | null;
}

export interface LeaseSummary {
  reference: string;
  status: LeaseStatus;
  propertyReference: string;
  propertyTitle: string;
  startDate: string;
  rentCents: number;
}

export function getLease(reference: string) {
  return apiFetchAuthed<LeaseView>(`/leases/${encodeURIComponent(reference)}`);
}

export function getMyLeases() {
  return apiFetchAuthed<LeaseSummary[]>('/leases');
}

// --- Honoraires locataire ----------------------------------------------------

export interface FeeLine {
  key: string;
  label: string;
  detail: string;
  amountCents: number;
  /** Plafond légal applicable à ce poste, pour le même bien. */
  legalCapCents: number;
}

export interface FeeBenchmark {
  agencyCents: number;
  platformCents: number;
  legalCapCents: number;
}

export interface FeesView {
  leaseReference: string;
  leaseStatus: LeaseStatus;
  propertyReference: string;
  propertyTitle: string;
  surfaceM2: number;
  lines: FeeLine[];
  totalCents: number;
  ownerShareCents: number;
  centsPerSqm: number;
  feeScheduleCode: string | null;
  feeScheduleApproved: boolean;
  benchmark: FeeBenchmark | null;
  depositCents: number;
  firstRentCents: number;
  moveInTotalCents: number;
  moveInDate: string;
  payment: {
    reference: string;
    status: PaymentStatus;
    amountCents: number;
    paidAt: string | null;
  } | null;
  blockers: string[];
  paymentDriver: string;
}

export function getLeaseFees(reference: string) {
  return apiFetchAuthed<FeesView>(
    `/tenant/leases/${encodeURIComponent(reference)}/fees`,
  );
}
