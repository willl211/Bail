'use client';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
export async function operationsRequest<T>(path: string, payload?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + path, {
      method: payload ? 'POST' : 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch {
    throw new Error('Impossible de joindre le service. Réessayez dans un instant.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(' ')
        : (body.message ?? 'Service indisponible.'),
    );
  }
  if (response.status === 204) return undefined as T;
  // Nest renvoie un corps vide quand aucune demande de suppression n’existe.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
export interface ErasureView {
  id: string;
  userId: string;
  accountLabel?: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  completedAt: string | null;
}
export const ERASURE_LABELS: Record<string, string> = {
  PENDING: 'À examiner',
  HOLD: 'Examen complémentaire',
  ERASING: 'Effacement en cours',
  COMPLETED: 'Effacement terminé',
};
export interface OperationsView {
  requests: ErasureView[];
  incidents: {
    fingerprint: string;
    requestId: string;
    category: string;
    route: string;
    count: number;
    acknowledgedAt: string | null;
    lastSeenAt: string;
  }[];
  securityEvents: { id: string; action: string; actorId: string | null; createdAt: string }[];
  failedMail: number;
  staleAnalysis: number;
  retentionDays: Record<string, number>;
}
