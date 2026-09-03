import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSignatureDriver } from './mock-signature.driver';
import { SIGNATURE_DRIVER, type SignatureDriver } from './signature.driver';

/**
 * Module de signature électronique.
 *
 * Le driver est choisi au démarrage par `SIGNATURE_DRIVER`. DocuSign est
 * retenu, mais son driver n'est pas écrit : contrairement à Stripe, dont le SDK
 * typé permet d'écrire une intégration vérifiable sans compte, une intégration
 * DocuSign écrite à l'aveugle — authentification JWT, gabarits d'enveloppe,
 * onglets de signature — ne serait vérifiable par rien et donnerait une fausse
 * impression d'avancement. Elle s'écrira contre le bac à sable, le jour où le
 * compte existe. Les variables d'environnement sont déjà prévues
 * (`DOCUSIGN_*`, voir `env/`).
 *
 * En attendant, un nom de driver inconnu fait échouer le démarrage plutôt que
 * de retomber sur le simulateur : en production, ça reviendrait à faire signer
 * des baux dans le vide.
 */
@Global()
@Module({
  providers: [
    {
      provide: SIGNATURE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SignatureDriver => {
        const name = config.get<string>('integrations.signature.driver', 'mock');

        if (name === 'mock') {
          Logger.log(
            'Signature : driver simulé (aucun compte DocuSign branché).',
            'SignatureModule',
          );
          return new MockSignatureDriver();
        }

        throw new Error(
          `SIGNATURE_DRIVER="${name}" n'est pas implémenté. Seul "mock" est disponible tant que le driver DocuSign n'est pas écrit contre le bac à sable (docs/integrations.md).`,
        );
      },
    },
  ],
  exports: [SIGNATURE_DRIVER],
})
export class SignatureModule {}
