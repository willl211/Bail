import { Logger, NotFoundException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { StorageDriver, StorageScope } from './storage.driver';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Deux conteneurs, pas un seul avec deux préfixes.
   *
   * Un préfixe se contourne par une clé forgée ou par une règle d'accès trop
   * large ; deux conteneurs se configurent séparément, et celui des pièces de
   * dossier peut rester fermé sans exception. C'est la même raison qui sépare
   * `storage/public` de `storage/private` sur disque.
   */
  publicBucket: string;
  privateBucket: string;
  /**
   * Style de chemin plutôt que de sous-domaine.
   *
   * Requis par MinIO et par la plupart des stockages compatibles S3 qui ne
   * disposent pas d'un DNS générique par conteneur — OVH Object Storage inclus
   * selon la région.
   */
  forcePathStyle: boolean;
  /** Base des URL publiques ; à défaut, construite depuis l'endpoint. */
  publicBaseUrl?: string;
}

/**
 * Stockage objet compatible S3 — OVH Object Storage en production, MinIO en
 * développement.
 *
 * Écrit contre un protocole, pas contre un hébergeur : le même code parle à
 * MinIO, à OVH ou à AWS, seules les variables changent. C'est ce qui le rend
 * vérifiable de bout en bout sans compte chez quiconque, comme le driver SMTP
 * — et ce qui le distingue de DocuSign, resté non écrit pour cette raison.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private readonly logger = new Logger(S3StorageDriver.name);
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  private bucket(scope: StorageScope): string {
    return scope === 'public' ? this.options.publicBucket : this.options.privateBucket;
  }

  /**
   * Vérifie que les deux conteneurs répondent, au démarrage.
   *
   * Sans faire échouer le lancement : une coupure passagère du stockage ne doit
   * pas rendre tout le site indisponible — la recherche, les candidatures et le
   * back-office fonctionnent sans lui. L'avertissement, lui, doit être visible
   * avant qu'un propriétaire ne dépose une photo dans le vide.
   */
  async verify(): Promise<void> {
    for (const scope of ['public', 'private'] as const) {
      const bucket = this.bucket(scope);
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
        this.logger.log(`Conteneur ${scope} joignable : ${bucket}`);
      } catch (error) {
        this.logger.warn(
          `Conteneur ${scope} injoignable (${bucket}) — les dépôts de fichiers échoueront. ${(error as Error).message}`,
        );
      }
    }
  }

  async put(
    scope: StorageScope,
    key: string,
    body: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(scope),
        Key: key,
        Body: body,
        ContentType: mimeType,
        // Aucune ACL n'est posée par objet : le régime d'accès est celui du
        // conteneur. Une ACL par objet serait une seconde source de vérité, et
        // c'est toujours celle qu'on oublie de mettre à jour.
      }),
    );
  }

  async get(scope: StorageScope, key: string): Promise<Readable> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(scope), Key: key }),
      );
      if (!response.Body) throw new NotFoundException('Fichier introuvable.');
      return response.Body as Readable;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      // `NoSuchKey`, `NotFound` ou un 404 selon l'implémentation : tous
      // signifient la même chose pour l'appelant.
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        throw new NotFoundException('Fichier introuvable.');
      }
      throw error;
    }
  }

  async delete(scope: StorageScope, key: string): Promise<void> {
    // S3 ne distingue pas la suppression d'un objet absent : la commande
    // réussit dans les deux cas, ce qui donne l'idempotence attendue.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket(scope), Key: key }),
    );
  }

  publicUrl(scope: StorageScope, key: string): string | null {
    if (scope !== 'public') return null;

    if (this.options.publicBaseUrl) {
      return `${this.options.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
    }
    // Repli sur l'endpoint : utilisable, mais on préférera l'URL du CDN quand
    // il y en aura un devant.
    const base = (this.options.endpoint ?? '').replace(/\/+$/, '');
    return `${base}/${this.options.publicBucket}/${key}`;
  }
}
