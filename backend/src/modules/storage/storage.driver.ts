import type { Readable } from 'node:stream';

/**
 * Régime d'accès du fichier. La distinction est structurelle, pas cosmétique :
 *
 * - `public`  : photos d'annonces. Servies directement — par le serveur web en
 *               développement, par le stockage objet ou un CDN en production.
 * - `private` : diagnostics techniques d'un bien, et pièces de dossier locataire
 *               (identité, bulletins de salaire). **Jamais** exposées
 *               directement — elles ne sortent que par une route applicative qui
 *               vérifie d'abord qui demande quoi.
 *
 * Les deux régimes vivent dans des espaces **physiquement distincts** — deux
 * racines sur disque, deux conteneurs en objet — pour qu'une seule erreur de
 * configuration ne puisse pas rendre une carte d'identité téléchargeable.
 */
export type StorageScope = 'public' | 'private';

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/**
 * Contrat du support de stockage.
 *
 * Volontairement réduit à quatre opérations d'entrée-sortie. Tout ce qui relève
 * des règles — formats acceptés, nommage des fichiers, assainissement des
 * dossiers — vit dans `StorageService`, au-dessus : ces règles ne doivent pas
 * dépendre du support, sans quoi changer de support reviendrait à les réécrire,
 * et donc à risquer de les affaiblir.
 */
export interface StorageDriver {
  /** Nom du driver, journalisé au démarrage. */
  readonly name: string;

  put(scope: StorageScope, key: string, body: Buffer, mimeType: string): Promise<void>;

  /** Lève si l'objet n'existe pas — l'appelant traduit en 404. */
  get(scope: StorageScope, key: string): Promise<Readable>;

  /** Idempotent : un fichier déjà absent n'est pas une erreur. */
  delete(scope: StorageScope, key: string): Promise<void>;

  /**
   * URL de lecture directe. `null` pour le régime privé : un fichier privé n'a
   * pas d'URL, et ne doit pas en avoir — c'est le sens même du régime.
   */
  publicUrl(scope: StorageScope, key: string): string | null;
}
