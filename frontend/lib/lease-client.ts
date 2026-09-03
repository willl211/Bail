'use client';

import type { LeaseView } from '@/lib/api';

/**
 * Actions sur un bail, depuis le navigateur.
 *
 * `credentials: 'include'` est indispensable : l'API est sur une autre origine,
 * sans quoi le cookie de session ne partirait pas.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface LeaseFailure {
  message: string;
  /** Ce qui empêche l'envoi en signature, quand l'API en fournit la liste. */
  blockers?: string[];
}

async function toFailure(response: Response): Promise<LeaseFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: 'Le service est momentanément indisponible.' };
  }

  const { message, blockers } = body as { message?: unknown; blockers?: string[] };
  if (Array.isArray(message)) return { message: message[0] ?? 'Requête invalide.', blockers };
  if (typeof message === 'string') return { message, blockers };
  return { message: 'Une erreur est survenue.', blockers };
}

export async function sendLeaseForSignature(reference: string): Promise<LeaseView> {
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/leases/${encodeURIComponent(reference)}/send`,
      { method: 'POST', credentials: 'include' },
    );
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies LeaseFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as LeaseView;
}

/** Accepte un candidat : ouvre son bail et fige les autres candidatures. */
export async function acceptApplication(applicationId: string): Promise<LeaseView> {
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/owner/applications/${encodeURIComponent(applicationId)}/accept`,
      { method: 'POST', credentials: 'include' },
    );
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies LeaseFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as LeaseView;
}
