import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockVideoDriver } from './mock-video.driver';
import { VIDEO_DRIVER, type VideoDriver } from './video.driver';

/**
 * Module de visio.
 *
 * Le driver est choisi au démarrage par `VIDEO_DRIVER`. Aucun prestataire
 * n'étant retenu (docs/integrations.md), `mock` est la seule valeur acceptée —
 * un nom inconnu fait échouer le démarrage plutôt que de retomber
 * silencieusement sur le simulateur, ce qui donnerait en production des
 * rendez-vous en visio impossibles à rejoindre.
 */
@Global()
@Module({
  providers: [
    {
      provide: VIDEO_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): VideoDriver => {
        const name = config.get<string>('integrations.video.driver', 'mock');

        if (name === 'mock') {
          Logger.log(
            'Visio : driver simulé (aucun prestataire retenu).',
            'VideoModule',
          );
          return new MockVideoDriver();
        }

        throw new Error(
          `VIDEO_DRIVER="${name}" inconnu. Aucun prestataire n'est encore retenu : seul "mock" est accepté (docs/integrations.md).`,
        );
      },
    },
  ],
  exports: [VIDEO_DRIVER],
})
export class VideoModule {}
