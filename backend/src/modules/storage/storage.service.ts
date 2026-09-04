import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Régime d'accès du fichier. La distinction est structurelle, pas cosmétique :
 *
 * - `public`  : photos d'annonces. Servies directement par le serveur web, comme
 *               elles le seront par un CDN en production.
 * - `private` : diagnostics techniques d'un bien, et pièces de dossier locataire
 *               (identité, bulletins de salaire). **Jamais** exposés
 *               statiquement — ils ne sortent que par une route qui vérifie
 *               d'abord qui demande quoi.
 *
 * Les deux régimes écrivent dans des racines distinctes pour qu'une erreur de
 * configuration du service de fichiers statiques ne puisse pas rendre une carte
 * d'identité téléchargeable.
 */
export type StorageScope = 'public' | 'private';

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

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {}

  private get driver(): string {
    return this.config.get<string>('storage.driver', 'local');
  }

  private rootFor(scope: StorageScope): string {
    const base = this.config.get<string>('storage.localPath', './storage');
    return resolve(base, scope);
  }

  /**
   * URL publique du fichier. `null` pour un fichier privé : il n'en a pas, et
   * ne doit pas en avoir — c'est le sens même du régime privé.
   */
  publicUrl(scope: StorageScope, key: string): string | null {
    if (scope !== 'public') return null;
    const base = this.config
      .get<string>('storage.publicBaseUrl', 'http://localhost:4000/uploads')
      .replace(/\/+$/, '');
    return `${base}/${key}`;
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

    if (this.driver !== 'local') {
      // Le driver S3/OVH viendra ici. Échouer bruyamment vaut mieux que d'écrire
      // sur le disque d'un serveur applicatif en croyant écrire sur l'objet.
      throw new BadRequestException(
        `Driver de stockage « ${this.driver} » non implémenté. Utilisez « local ».`,
      );
    }

    const safeFolder = this.sanitizeFolder(folder);
    const name = `${randomUUID()}${EXTENSIONS[file.mimetype] ?? extname(file.originalname)}`;
    const key = `${safeFolder}/${name}`;

    const directory = join(this.rootFor(scope), safeFolder);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), file.buffer);

    this.logger.log(`Fichier écrit (${scope}) : ${key} — ${file.size} octets`);
    return { key, size: file.size, mimeType: file.mimetype };
  }

  /**
   * Ouvre un fichier en lecture.
   *
   * C'est la seule façon de sortir un fichier **privé** : il n'est servi par
   * aucune URL statique, donc il faut une route applicative qui vérifie d'abord
   * qui demande quoi.
   */
  async read(scope: StorageScope, key: string): Promise<Readable> {
    if (this.driver !== 'local') {
      throw new BadRequestException(
        `Driver de stockage « ${this.driver} » non implémenté. Utilisez « local ».`,
      );
    }

    const target = this.resolveWithinRoot(scope, key);
    if (!target) throw new NotFoundException('Fichier introuvable.');

    try {
      await access(target, constants.R_OK);
    } catch {
      throw new NotFoundException('Fichier introuvable.');
    }

    return createReadStream(target);
  }

  /** Suppression idempotente : un fichier déjà absent n'est pas une erreur. */
  async remove(scope: StorageScope, key: string): Promise<void> {
    if (this.driver !== 'local') return;

    const target = this.resolveWithinRoot(scope, key);
    if (!target) return;

    try {
      await unlink(target);
    } catch {
      // Fichier déjà supprimé, ou jamais écrit : rien à faire.
    }
  }

  /**
   * Résout une clé en chemin absolu, en refusant tout ce qui sortirait de la
   * racine du régime. Une clé forgée (`../../`) ne doit pas donner accès au
   * disque, et surtout pas faire franchir la frontière entre public et privé.
   */
  private resolveWithinRoot(scope: StorageScope, key: string): string | null {
    const root = this.rootFor(scope);
    const target = resolve(root, normalize(key));
    if (target !== root && !target.startsWith(root + sep)) {
      this.logger.warn(`Clé hors racine refusée (${scope}) : ${key}`);
      return null;
    }
    return target;
  }

  /** N'autorise qu'un segment de dossier simple, en minuscules. */
  private sanitizeFolder(folder: string): string {
    const cleaned = folder
      .toLowerCase()
      .replace(/[^a-z0-9/-]/g, '-')
      .replace(/\.+/g, '')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '');

    if (!cleaned) throw new BadRequestException('Destination de stockage invalide.');
    return cleaned;
  }
}
