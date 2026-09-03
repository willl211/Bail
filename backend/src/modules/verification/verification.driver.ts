import type { DocumentType } from '@prisma/client';

/**
 * Contrat du prestataire de vérification de pièces (KYC et contrôle
 * documentaire).
 *
 * Le prestataire n'est **pas choisi** (docs/integrations.md) : `mock` est la
 * seule valeur admise pour l'instant. Toute la logique métier passe par cette
 * interface, jamais par un SDK — le jour où un prestataire est retenu, brancher
 * son driver ne doit demander qu'une variable d'environnement.
 *
 * Deux régimes coexistent volontairement :
 *
 * - **synchrone** : le prestataire tranche tout de suite (lecture MRZ d'une
 *   pièce d'identité, cohérence d'un bulletin) ;
 * - **différé** : la pièce part en contrôle et le verdict revient plus tard,
 *   par webhook.
 *
 * Le second existe dès maintenant même si le mock ne s'en sert pas : une
 * intégration réelle en dépendra, et l'ajouter après coup obligerait à
 * retoucher le code métier.
 */

export interface VerificationRequest {
  /** Identifiant interne de la pièce, renvoyé tel quel par le prestataire. */
  documentId: string;
  type: DocumentType;
  mimeType: string;
  fileName: string;
  /** Régime et clé de stockage, pour que le driver aille chercher le fichier. */
  storageKey: string;
}

export type VerificationOutcome =
  /** Contrôle passé. */
  | { status: 'verified'; note: string }
  /** Contrôle échoué : la pièce doit être remplacée. */
  | { status: 'rejected'; reason: string }
  /**
   * Le prestataire ne tranche pas seul : la pièce attend un contrôle humain.
   * Ce n'est pas un échec, et l'écran doit le dire autrement qu'un refus.
   */
  | { status: 'manual'; note: string }
  /** Contrôle lancé, verdict à venir par webhook. */
  | { status: 'processing'; providerId: string };

export const VERIFICATION_DRIVER = Symbol('VERIFICATION_DRIVER');

export interface VerificationDriver {
  /** Nom du driver, exposé par `/health` pour savoir ce qui tourne. */
  readonly name: string;

  /**
   * Soumet une pièce au contrôle.
   *
   * Ne lève pas sur un document non conforme : « refusé » est un résultat
   * normal du métier, pas une erreur technique.
   */
  verify(request: VerificationRequest): Promise<VerificationOutcome>;
}
