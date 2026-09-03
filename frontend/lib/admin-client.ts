'use client';

import type { AdminFileRow, AdminPropertyRow, AdminVisitRow } from '@/lib/api';

/**
 * Décisions du back-office, depuis le navigateur.
 *
 * `credentials: 'include'` est indispensable : l'API est sur une autre origine,
 * sans quoi le cookie de session ne partirait pas.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface AdminFailure {
  message: string;
  /** Ce qui empêche la décision, quand l'API en fournit la liste. */
  blockers?: string[];
}

async function toFailure(response: Response): Promise<AdminFailure> {
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

async function post<T>(path: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw { message: 'Impossible de joindre le service.' } satisfies AdminFailure;
  }

  if (!response.ok) throw await toFailure(response);
  return (await response.json()) as T;
}

export function decideDocument(
  documentId: string,
  decision: 'VERIFY' | 'REJECT',
  reason?: string,
) {
  return post<AdminFileRow[]>(
    `/admin/documents/${encodeURIComponent(documentId)}/decision`,
    { decision, reason },
  );
}

export function decideFile(
  reference: string,
  decision: 'VERIFY' | 'REJECT',
  reason?: string,
) {
  return post<AdminFileRow[]>(
    `/admin/tenant-files/${encodeURIComponent(reference)}/decision`,
    { decision, reason },
  );
}

export function decideProperty(
  reference: string,
  decision: 'PUBLISH' | 'REJECT',
  reason?: string,
) {
  return post<AdminPropertyRow[]>(
    `/admin/properties/${encodeURIComponent(reference)}/decision`,
    { decision, reason },
  );
}

export function assignVisit(visitId: string, agentId: string) {
  return post<AdminVisitRow[]>(`/admin/visits/${encodeURIComponent(visitId)}/assign`, {
    agentId,
  });
}
