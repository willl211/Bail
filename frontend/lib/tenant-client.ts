'use client';

import type {
  DocumentType,
  EmploymentContractType,
  GuarantorKind,
  TenantFileView,
} from '@/lib/api';

/**
 * Mutations du dossier locataire, depuis le navigateur.
 *
 * Chaque appel renvoie le dossier complet : l'écran se reconstruit à partir de
 * la réponse, sans second aller-retour ni recalcul local d'un état que le
 * serveur vient de calculer.
 *
 * `credentials: 'include'` est indispensable — l'API est sur une autre origine,
 * sans quoi le cookie de session ne partirait pas.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface TenantFailure {
  message: string;
  /** Ce qui manque, quand la transmission est refusée. */
  missing?: string[];
}

async function toFailure(response: Response): Promise<TenantFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: 'Le service est momentanément indisponible.' };
  }

  const { message, missing } = body as { message?: unknown; missing?: string[] };
  if (Array.isArray(message)) {
    return { message: message[0] ?? 'Formulaire invalide.', missing };
  }
  if (typeof message === 'string') return { message, missing };
  return { message: 'Une erreur est survenue.', missing };
}

async function send(
  method: string,
  path: string,
  payload?: unknown,
): Promise<TenantFileView> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies TenantFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as TenantFileView;
}

export interface TenantProfilePayload {
  contractType?: EmploymentContractType;
  employerName?: string;
  netMonthlyIncomeCents?: number;
  inProbationPeriod?: boolean;
}

export function updateProfile(payload: TenantProfilePayload) {
  return send('PATCH', '/tenant/file', payload);
}

export function submitFile() {
  return send('POST', '/tenant/file/submit');
}

/**
 * Dépose une pièce.
 *
 * Pas d'en-tête `Content-Type` : c'est au navigateur de le poser, avec la
 * frontière multipart qu'il a générée. En le fixant à la main, la requête
 * serait illisible côté serveur.
 */
export async function uploadDocument(
  type: DocumentType,
  file: File,
): Promise<TenantFileView> {
  const body = new FormData();
  body.append('file', file);
  body.append('type', type);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/tenant/file/documents`, {
      method: 'POST',
      credentials: 'include',
      body,
    });
  } catch {
    throw { message: 'Impossible d’envoyer la pièce.' } satisfies TenantFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as TenantFileView;
}

export function deleteDocument(documentId: string) {
  return send('DELETE', `/tenant/file/documents/${encodeURIComponent(documentId)}`);
}

export interface GuarantorPayload {
  kind: GuarantorKind;
  firstName?: string;
  lastName?: string;
  organisationName?: string;
  relationship?: string;
  netMonthlyIncomeCents?: number;
  contractType?: EmploymentContractType;
}

export function saveGuarantor(payload: GuarantorPayload) {
  return send('PUT', '/tenant/file/guarantor', payload);
}

export function deleteGuarantor() {
  return send('DELETE', '/tenant/file/guarantor');
}

/**
 * Adresse de consultation d'une pièce.
 *
 * Le fichier n'a pas d'URL publique : il ne sort que par cette route, qui
 * vérifie la session. Ouvrir le lien sans être connecté renvoie 401.
 */
export function documentFileUrl(documentId: string) {
  return `${API_URL}/tenant/file/documents/${encodeURIComponent(documentId)}/file`;
}
