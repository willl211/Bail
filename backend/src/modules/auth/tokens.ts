import { createHash, randomBytes } from 'node:crypto';

/**
 * Secrets d'authentification transportés hors de la base : cookie de session,
 * lien de confirmation d'adresse, lien de réinitialisation.
 *
 * Un seul endroit pour les fabriquer et les hacher, parce qu'ils obéissent à la
 * même règle : le secret circule, seule son empreinte est stockée. Deux
 * implémentations divergentes finiraient par en stocker un en clair.
 */

/** 256 bits d'aléa, en base64url — utilisable tel quel dans une URL. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 suffit ici, et bcrypt serait un contresens : ces secrets ont 256 bits
 * d'entropie et ne se devinent pas par force brute, contrairement à un mot de
 * passe choisi par un humain — qui, lui, exige bcrypt. Un hachage lent ne
 * ferait que ralentir chaque requête authentifiée.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
