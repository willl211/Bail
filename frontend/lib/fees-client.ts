'use client';

import type { FeesView } from '@/lib/api';

/**
 * Règlement des honoraires, depuis le navigateur.
 *
 * Ne transporte **jamais** de coordonnées bancaires : cet appel ouvre une
 * intention de paiement chez le prestataire et récupère de quoi la confirmer
 * dans son propre formulaire. La carte ne passe pas par Bail.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface FeesFailure {
  message: string;
  blockers?: string[];
}

async function toFailure(response: Response): Promise<FeesFailure> {
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

export async function startFeePayment(
  reference: string,
): Promise<{ clientSecret: string | null; view: FeesView }> {
  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/tenant/leases/${encodeURIComponent(reference)}/fees`,
      { method: 'POST', credentials: 'include' },
    );
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies FeesFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as { clientSecret: string | null; view: FeesView };
}
