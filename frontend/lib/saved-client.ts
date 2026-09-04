'use client';

/**
 * Sauvegarde d'un bien, depuis le navigateur.
 *
 * `credentials: 'include'` est indispensable : l'API est sur une autre origine,
 * sans quoi le cookie de session ne partirait pas.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

async function call(method: 'PUT' | 'DELETE', reference: string): Promise<boolean> {
  const response = await fetch(
    `${API_URL}/tenant/saved/${encodeURIComponent(reference)}`,
    { method, credentials: 'include' },
  );
  if (!response.ok) throw new Error(String(response.status));
  const body = (await response.json()) as { saved: boolean };
  return body.saved;
}

export const saveProperty = (reference: string) => call('PUT', reference);
export const unsaveProperty = (reference: string) => call('DELETE', reference);
