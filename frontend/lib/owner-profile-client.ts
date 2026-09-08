'use client';

import type { CurrentUser, OwnerProfile } from '@/lib/api';

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

async function save<T>(path: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
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

  return (await response.json()) as T;
}

export function saveOwnerProfile(payload: { addressLine: string; postalCode: string; city: string }) {
  return save<OwnerProfile>('/owner/profile', payload);
}

export function saveOwnerContact(payload: { firstName: string; lastName: string; phone: string }) {
  return save<CurrentUser>('/owner/contact', payload);
}
