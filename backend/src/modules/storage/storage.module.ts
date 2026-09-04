import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { STORAGE_DRIVER, type StorageDriver } from './storage.driver';
import { StorageService } from './storage.service';

/**
 * Stockage de fichiers, derrière un driver — comme les autres intégrations
 * (docs/integrations.md). `local` en développement, `s3` en staging et en
 * production, sans une ligne de code métier à changer.
 *
 * Un nom de driver inconnu fait échouer le démarrage. C'est particulièrement
 * important ici : retomber silencieusement sur `local` en production ferait
 * écrire les pièces d'identité sur le disque éphémère d'un conteneur, où elles
 * disparaîtraient au premier redéploiement — sans que rien ne le signale.
 *
 * Un `s3` mal configuré échoue aussi au démarrage plutôt que d'accepter des
 * dépôts qui n'aboutiraient nulle part.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriver => {
        const name = config.get<string>('storage.driver', 'local');

        if (name === 'local') {
          Logger.log(
            'Stockage : disque local. Convient au développement et à une instance unique — pas à plusieurs serveurs derrière un répartiteur.',
            'StorageModule',
          );
          return new LocalStorageDriver({
            root: config.get<string>('storage.localPath', './storage'),
            publicBaseUrl: config.get<string>(
              'storage.publicBaseUrl',
              'http://localhost:4000/uploads',
            ),
          });
        }

        if (name === 's3') {
          const s3 = config.get<Record<string, string | undefined>>('storage.s3') ?? {};
          const manquantes = (
            [
              ['S3_REGION', s3.region],
              ['S3_ACCESS_KEY_ID', s3.accessKeyId],
              ['S3_SECRET_ACCESS_KEY', s3.secretAccessKey],
              ['S3_BUCKET_PUBLIC', s3.publicBucket],
              ['S3_BUCKET_PRIVATE', s3.privateBucket],
            ] as const
          )
            .filter(([, valeur]) => !valeur)
            .map(([nom]) => nom);

          if (manquantes.length > 0) {
            throw new Error(
              `STORAGE_DRIVER="s3" mais ces variables manquent : ${manquantes.join(', ')}. ` +
                'Démarrer sans elles accepterait des dépôts de fichiers qui n’aboutiraient nulle part.',
            );
          }
          if (s3.publicBucket === s3.privateBucket) {
            throw new Error(
              'S3_BUCKET_PUBLIC et S3_BUCKET_PRIVATE désignent le même conteneur. ' +
                'Les deux régimes doivent être séparés physiquement : une seule règle ' +
                'd’accès trop large rendrait sinon les pièces d’identité téléchargeables.',
            );
          }

          const driver = new S3StorageDriver({
            endpoint: s3.endpoint,
            region: s3.region as string,
            accessKeyId: s3.accessKeyId as string,
            secretAccessKey: s3.secretAccessKey as string,
            publicBucket: s3.publicBucket as string,
            privateBucket: s3.privateBucket as string,
            forcePathStyle: config.get<boolean>('storage.s3.forcePathStyle', true),
            publicBaseUrl: config.get<string | undefined>('storage.publicBaseUrl'),
          });
          // Vérification non bloquante : une coupure passagère du stockage ne
          // doit pas rendre indisponibles la recherche, les candidatures et le
          // back-office, qui n'en dépendent pas.
          void driver.verify();
          Logger.log(`Stockage : objet S3 (${s3.endpoint ?? s3.region}).`, 'StorageModule');
          return driver;
        }

        throw new Error(
          `STORAGE_DRIVER="${name}" inconnu. Valeurs acceptées : "local" ou "s3".`,
        );
      },
    },
    StorageService,
  ],
  exports: [STORAGE_DRIVER, StorageService],
})
export class StorageModule {}
