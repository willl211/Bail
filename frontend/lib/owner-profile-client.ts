'use client';

import type { OwnerProfile } from '@/lib/api';

/**
 * Enregistrement des coordonnées du bailleur, depuis le navigateur.
 *
 * `credentials: 'include'` est indispensable : l'API est sur une autre origine,
 * sans quoi le cookie de session ne partirait pas.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ProfileFailure {
  message: string;
}

export async function saveOwnerProfile(payload: {
  addressLine: string;
  postalCode: string;
  city: string;
}): Promise<OwnerProfile> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/owner/profile`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies ProfileFailure;
  }

  if (!response.ok) {
    let message = 'Une erreur est survenue.';
    try {
      const body = (await response.json()) as { message?: unknown };
      // NestJS renvoie `message` en tableau sur un échec de validation : on
      // affiche le premier, celui du champ qui bloque.
      if (Array.isArray(body.message)) message = String(body.message[0] ?? message);
      else if (typeof body.message === 'string') message = body.message;
    } catch {
      message = 'Le service est momentanément indisponible.';
    }
    throw { message } satisfies ProfileFailure;
  }

  return (await response.json()) as OwnerProfile;
}
