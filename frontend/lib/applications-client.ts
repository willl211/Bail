'use client';

import type { CandidacyPreview } from '@/lib/api';

/**
 * Envoi de candidature, depuis le navigateur.
 *
 * `credentials: 'include'` est indispensable : l'API est sur une autre
 * origine, sans quoi le cookie de session ne partirait pas.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApplicationFailure {
  message: string;
  /** Ce qui bloque encore l'envoi, quand l'API en fournit la liste. */
  blockers?: string[];
}

async function toFailure(response: Response): Promise<ApplicationFailure> {
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

export async function apply(
  reference: string,
  payload: { message?: string },
): Promise<CandidacyPreview> {
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/tenant/applications/${encodeURIComponent(reference)}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies ApplicationFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as CandidacyPreview;
}
