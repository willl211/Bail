'use client';

import type {
  OwnerSlotView,
  VisitBookingView,
  VisitType,
  VisitView,
} from '@/lib/api';

/**
 * Prise de rendez-vous et gestion des créneaux, depuis le navigateur.
 *
 * `credentials: 'include'` est indispensable : l'API est sur une autre origine,
 * sans quoi le cookie de session ne partirait pas.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface VisitFailure {
  message: string;
}

async function toFailure(response: Response): Promise<VisitFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: 'Le service est momentanément indisponible.' };
  }

  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return { message: message[0] ?? 'Requête invalide.' };
  if (typeof message === 'string') return { message };
  return { message: 'Une erreur est survenue.' };
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
    throw { message: 'Impossible de joindre le service.' } satisfies VisitFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as T;
}

// --- Locataire ---------------------------------------------------------------

export function bookVisit(reference: string, slotId: string, type: VisitType) {
  return send<VisitBookingView>(
    'POST',
    `/tenant/visits/property/${encodeURIComponent(reference)}`,
    { slotId, type },
  );
}

export function cancelVisit(visitId: string, reason?: string) {
  return send<VisitView[]>('DELETE', `/tenant/visits/${encodeURIComponent(visitId)}`, {
    reason,
  });
}

// --- Propriétaire ------------------------------------------------------------

export function openSlots(reference: string, startsAt: string[], allowedTypes: VisitType[]) {
  return send<OwnerSlotView[]>(
    'POST',
    `/owner/properties/${encodeURIComponent(reference)}/slots`,
    { startsAt, allowedTypes },
  );
}

export function closeSlot(reference: string, slotId: string) {
  return send<OwnerSlotView[]>(
    'DELETE',
    `/owner/properties/${encodeURIComponent(reference)}/slots/${encodeURIComponent(slotId)}`,
  );
}

// --- Décision du propriétaire sur une candidature -----------------------------

export function shortlistApplication<T>(applicationId: string) {
  return send<T>('POST', `/owner/applications/${encodeURIComponent(applicationId)}/shortlist`);
}

export function rejectApplication<T>(applicationId: string, reason?: string) {
  return send<T>('POST', `/owner/applications/${encodeURIComponent(applicationId)}/reject`, {
    reason,
  });
}
