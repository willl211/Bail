import { Logger, NotFoundException } from '@nestjs/common';
import { constants, createReadStream } from 'node:fs';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageDriver, StorageScope } from './storage.driver';

export interface LocalStorageOptions {
  /** Racine des deux régimes : `<root>/public` et `<root>/private`. */
  root: string;
  /** Base des URL de fichiers publics, servie statiquement par l'API. */
  publicBaseUrl: string;
}

/**
 * Stockage sur le disque du serveur applicatif.
 *
 * Convient au développement et à une instance unique. Il ne convient **pas** à
 * plusieurs instances : deux serveurs derrière un répartiteur ne partageraient
 * pas leurs fichiers, et une photo déposée sur l'un serait introuvable depuis
 * l'autre. C'est la raison d'être du driver S3.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly logger = new Logger(LocalStorageDriver.name);

  constructor(private readonly options: LocalStorageOptions) {}

  private rootFor(scope: StorageScope): string {
    return resolve(this.options.root, scope);
  }

  /**
   * Résout une clé en chemin absolu, en refusant tout ce qui sortirait de la
   * racine du régime.
   *
   * Une clé forgée (`../../`) ne doit pas donner accès au disque, et surtout pas
   * faire franchir la frontière entre public et privé — ce serait exactement la
   * façon dont une pièce d'identité deviendrait téléchargeable.
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

  /**
   * Le type MIME fait partie du contrat mais ne sert pas ici : sur disque, il
   * n'est pas stocké avec le fichier — c'est la base qui le porte. La signature
   * reste identique à celle du driver objet pour que les deux soient
   * interchangeables sans adaptation au point d'appel.
   */
  async put(
    scope: StorageScope,
    key: string,
    body: Buffer,
    _mimeType?: string,
  ): Promise<void> {
    const target = this.resolveWithinRoot(scope, key);
    if (!target) throw new NotFoundException('Destination de stockage invalide.');

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(scope: StorageScope, key: string): Promise<Readable> {
    const target = this.resolveWithinRoot(scope, key);
    if (!target) throw new NotFoundException('Fichier introuvable.');

    try {
      await access(target, constants.R_OK);
    } catch {
      throw new NotFoundException('Fichier introuvable.');
    }
    return createReadStream(target);
  }

  async delete(scope: StorageScope, key: string): Promise<void> {
    const target = this.resolveWithinRoot(scope, key);
    if (!target) return;
    try {
      await unlink(target);
    } catch {
      // Fichier déjà supprimé, ou jamais écrit : rien à faire.
    }
  }

  publicUrl(scope: StorageScope, key: string): string | null {
    if (scope !== 'public') return null;
    return `${this.options.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }
}
