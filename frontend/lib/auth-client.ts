'use client';

/**
 * Appels d'authentification depuis le navigateur.
 *
 * `credentials: 'include'` est indispensable : c'est l'API qui pose le cookie
 * de session, et sans cette option le navigateur ne l'accepterait ni ne le
 * renverrait, l'API étant sur une autre origine que le front.
 *
 * L'URL est celle vue depuis le navigateur (`NEXT_PUBLIC_API_URL`), jamais
 * l'URL interne du serveur.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface AuthFailure {
  /** Message unique, prêt à afficher. */
  message: string;
  /** Erreurs de validation champ par champ, quand l'API en fournit. */
  details?: string[];
}

/**
 * Extrait un message lisible d'une réponse d'erreur.
 *
 * NestJS renvoie `message` tantôt en chaîne, tantôt en tableau selon qu'il
 * s'agit d'une exception métier ou d'un échec de validation.
 */
async function toFailure(response: Response): Promise<AuthFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: 'Le service est momentanément indisponible.' };
  }

  const message = (body as { message?: unknown }).message;

  if (Array.isArray(message)) {
    return { message: message[0] ?? 'Formulaire invalide.', details: message as string[] };
  }
  if (typeof message === 'string') return { message };
  return { message: 'Une erreur est survenue.' };
}

async function post<T>(path: string, payload?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw {
      message: 'Impossible de joindre le service. Vérifiez votre connexion.',
    } satisfies AuthFailure;
  }

  if (!response.ok) throw await toFailure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: 'OWNER' | 'TENANT';
}

export function register(payload: RegisterPayload) {
  return post<{ user: { id: string; role: string } }>('/auth/register', payload);
}

export function login(email: string, password: string) {
  return post<{ user: { id: string; role: string } }>('/auth/login', { email, password });
}

export function logout() {
  return post<void>('/auth/logout');
}

// ------------------------------------------------- Confirmation d'adresse

/** Renvoie le lien de confirmation au compte connecté. */
export function resendVerification() {
  return post<void>('/auth/email/verification');
}

/**
 * Confirme l'adresse. Publique côté API : le lien s'ouvre souvent depuis un
 * autre appareil que celui où la session a été ouverte.
 */
export function confirmEmail(token: string) {
  return post<{ email: string }>('/auth/email/verification/confirm', { token });
}

// --------------------------------------------------- Mot de passe oublié

/**
 * Demande un lien de réinitialisation.
 *
 * Réussit toujours, y compris pour une adresse inconnue : l'API répond 204 dans
 * tous les cas, faute de quoi ce formulaire public dirait qui a un compte.
 */
export function forgotPassword(email: string) {
  return post<void>('/auth/password/forgot', { email });
}

export function resetPassword(token: string, password: string) {
  return post<void>('/auth/password/reset', { token, password });
}

export function changePassword(currentPassword: string, password: string) {
  return post<void>('/auth/password/change', { currentPassword, password });
}
