'use client';

/**
 * Mutations de l'espace propriétaire, depuis le navigateur.
 *
 * Comme pour l'authentification, `credentials: 'include'` est indispensable :
 * l'API est sur une autre origine, sans quoi le cookie de session ne partirait
 * pas et chaque requête reviendrait en 401.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiFailure {
  message: string;
  /** Blocages renvoyés par la soumission au contrôle, quand il y en a. */
  blockers?: string[];
}

async function toFailure(response: Response): Promise<ApiFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: 'Le service est momentanément indisponible.' };
  }

  const { message, blockers } = body as { message?: unknown; blockers?: string[] };

  if (Array.isArray(message)) {
    return { message: message[0] ?? 'Formulaire invalide.', blockers };
  }
  if (typeof message === 'string') return { message, blockers };
  return { message: 'Une erreur est survenue.', blockers };
}

async function send<T>(method: string, path: string, payload?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies ApiFailure;
  }

  if (!response.ok) throw await toFailure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Champs modifiables d'une annonce. Les montants sont en centimes. */
export interface PropertyDraft {
  title?: string;
  description?: string;
  addressLine?: string;
  districtSlug?: string;
  surfaceM2?: number;
  rooms?: number;
  bedrooms?: number;
  floor?: string;
  furnished?: boolean;
  energyRating?: string;
  gesRating?: string;
  constructionYear?: number;
  rentCents?: number;
  chargesCents?: number;
  availableFrom?: string;
  minMonthlyIncomeCents?: number;
  guarantorRequirement?: string;
  acceptedContractTypes?: string[];
}

export function createDraft(draft: PropertyDraft) {
  return send<{ reference: string }>('POST', '/owner/properties', draft);
}

export function updateDraft(reference: string, draft: PropertyDraft) {
  return send<{ reference: string }>(
    'PATCH',
    `/owner/properties/${encodeURIComponent(reference)}`,
    draft,
  );
}

export function submitForReview(reference: string) {
  return send<{ status: string }>(
    'POST',
    `/owner/properties/${encodeURIComponent(reference)}/submit`,
  );
}

/**
 * Envoie une photo.
 *
 * Pas d'en-tête `Content-Type` ici : c'est au navigateur de le poser, avec la
 * frontière multipart qu'il a générée. En le fixant à la main, la requête
 * serait illisible côté serveur.
 */
export async function uploadPhoto(reference: string, file: File, caption?: string) {
  const body = new FormData();
  body.append('file', file);
  if (caption) body.append('caption', caption);

  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/owner/properties/${encodeURIComponent(reference)}/photos`,
      { method: 'POST', credentials: 'include', body },
    );
  } catch {
    throw { message: 'Impossible d’envoyer la photo.' } satisfies ApiFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as { id: string; url: string | null; position: number };
}

export function deletePhoto(reference: string, photoId: string) {
  return send<void>(
    'DELETE',
    `/owner/properties/${encodeURIComponent(reference)}/photos/${encodeURIComponent(photoId)}`,
  );
}

export type PropertyDocumentType =
  | 'DPE'
  | 'ASBESTOS'
  | 'LEAD'
  | 'ERP'
  | 'ELECTRICAL'
  | 'GAS'
  | 'OTHER';

export async function uploadDocument(
  reference: string,
  type: PropertyDocumentType,
  file: File,
  issuedAt?: string,
) {
  const body = new FormData();
  body.append('file', file);
  body.append('type', type);
  if (issuedAt) body.append('issuedAt', issuedAt);

  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/owner/properties/${encodeURIComponent(reference)}/documents`,
      { method: 'POST', credentials: 'include', body },
    );
  } catch {
    throw { message: 'Impossible d’envoyer le diagnostic.' } satisfies ApiFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as { id: string; type: string; status: string };
}

export function deleteDocument(reference: string, documentId: string) {
  return send<void>(
    'DELETE',
    `/owner/properties/${encodeURIComponent(reference)}/documents/${encodeURIComponent(documentId)}`,
  );
}

/**
 * Adresse de consultation d'un diagnostic.
 *
 * Le fichier n'a pas d'URL publique : il ne sort que par cette route, qui
 * vérifie la session. Ouvrir le lien sans être connecté renvoie 401.
 */
export function documentFileUrl(reference: string, documentId: string) {
  return `${API_URL}/owner/properties/${encodeURIComponent(reference)}/documents/${encodeURIComponent(documentId)}/file`;
}

// --- Abonnement --------------------------------------------------------------

/**
 * Les trois mutations renvoient l'état complet de l'abonnement : la page peut
 * se rafraîchir depuis la réponse, sans second aller-retour.
 */
export function subscribe<T>() {
  return send<T>('POST', '/owner/subscription');
}

export function cancelSubscription<T>() {
  return send<T>('DELETE', '/owner/subscription');
}

export function resumeSubscription<T>() {
  return send<T>('POST', '/owner/subscription/resume');
}
