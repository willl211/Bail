import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockVerificationDriver } from './mock-verification.driver';
import { VERIFICATION_DRIVER, type VerificationDriver } from './verification.driver';

/**
 * Module de vérification des pièces.
 *
 * Le driver est choisi au démarrage par `KYC_DRIVER`. Aucun prestataire n'étant
 * retenu (docs/integrations.md), `mock` est pour l'instant la seule valeur
 * acceptée — et un nom inconnu fait échouer le démarrage plutôt que de
 * retomber silencieusement sur le simulateur, ce qui, en production,
 * reviendrait à valider des pièces d'identité sans les contrôler.
 */
@Global()
@Module({
  providers: [
    {
      provide: VERIFICATION_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): VerificationDriver => {
        const name = config.get<string>('integrations.kyc.driver', 'mock');

        if (name === 'mock') {
          Logger.log(
            'Vérification des pièces : driver simulé (aucun prestataire KYC retenu).',
            'VerificationModule',
          );
          return new MockVerificationDriver();
        }

        throw new Error(
          `KYC_DRIVER="${name}" inconnu. Aucun prestataire n'est encore retenu : seul "mock" est accepté (docs/integrations.md).`,
        );
      },
    },
  ],
  exports: [VERIFICATION_DRIVER],
})
export class VerificationModule {}
