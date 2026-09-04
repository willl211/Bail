import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import {
  STORAGE_DRIVER,
  type StorageDriver,
  type StorageScope,
} from './storage.driver';
import { sanitizeFolder } from './storage.keys';

export type { StorageScope } from './storage.driver';

export interface StoredFile {
  /** Chemin relatif à la racine du régime, ex. `properties/mz-0193/a1b2.jpg`. */
  key: string;
  size: number;
  mimeType: string;
}

/** Fichier téléversé, tel que Multer le fournit. */
export interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DOCUMENT_TYPES = ['application/pdf', ...IMAGE_TYPES] as const;

/** Extension déduite du type déclaré, jamais du nom de fichier fourni. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * Dépôt et lecture des fichiers.
 *
 * Toutes les **règles** vivent ici et nulle part ailleurs : formats acceptés,
 * nommage des fichiers, assainissement des dossiers. Le driver, en dessous, ne
 * fait que des entrées-sorties. Cette séparation n'est pas décorative — si le
 * nommage vivait dans chaque driver, changer de support reviendrait à réécrire
 * les garde-fous, et donc à risquer de les affaiblir sans s'en apercevoir.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(@Inject(STORAGE_DRIVER) private readonly driver: StorageDriver) {}

  /**
   * URL publique du fichier. `null` pour un fichier privé : il n'en a pas, et
   * ne doit pas en avoir — c'est le sens même du régime privé.
   */
  publicUrl(scope: StorageScope, key: string): string | null {
    return this.driver.publicUrl(scope, key);
  }

  /**
   * Écrit un fichier et renvoie sa clé.
   *
   * Le nom d'origine n'est jamais réutilisé : il vient du client et pourrait
   * contenir des séquences de traversée (`../`) ou des caractères hostiles au
   * système de fichiers. Le nom stocké est un UUID, l'extension est déduite du
   * type MIME accepté.
   */
  async save(
    scope: StorageScope,
    folder: string,
    file: IncomingFile,
    allowed: readonly string[],
  ): Promise<StoredFile> {
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `Format non accepté (${file.mimetype}). Formats attendus : ${allowed.join(', ')}.`,
      );
    }

    const safeFolder = sanitizeFolder(folder);
    if (!safeFolder) throw new BadRequestException('Destination de stockage invalide.');
    const name = `${randomUUID()}${EXTENSIONS[file.mimetype] ?? extname(file.originalname)}`;
    const key = `${safeFolder}/${name}`;

    await this.driver.put(scope, key, file.buffer, file.mimetype);

    this.logger.log(`Fichier écrit (${scope}, ${this.driver.name}) : ${key} — ${file.size} octets`);
    return { key, size: file.size, mimeType: file.mimetype };
  }

  /**
   * Ouvre un fichier en lecture.
   *
   * C'est la seule façon de sortir un fichier **privé** : il n'est servi par
   * aucune URL, donc il faut une route applicative qui vérifie d'abord qui
   * demande quoi.
   */
  read(scope: StorageScope, key: string): Promise<Readable> {
    return this.driver.get(scope, key);
  }

  /** Suppression idempotente : un fichier déjà absent n'est pas une erreur. */
  async remove(scope: StorageScope, key: string): Promise<void> {
    try {
      await this.driver.delete(scope, key);
    } catch (error) {
      // Ne remonte pas : la suppression accompagne toujours une opération
      // métier déjà accomplie — remplacer un diagnostic, retirer une photo — et
      // la faire échouer laisserait la base et le stockage en désaccord.
      this.logger.warn(`Suppression impossible (${scope}) : ${(error as Error).message}`);
    }
  }
}
