import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSignatureDriver } from './mock-signature.driver';
import { SIGNATURE_DRIVER, type SignatureDriver } from './signature.driver';
import { DocusignSignatureDriver } from './docusign-signature.driver';

/**
 * Module de signature électronique.
 *
 * `mock` reste le défaut local. `docusign` exige une configuration complète
 * et n'accepte que le serveur sandbox ; sa recette externe reste nécessaire.
 * Aucun repli silencieux vers le simulateur en cas de mauvaise configuration.
 * Voir docs/signatures.md.
 */
@Global()
@Module({
  providers: [
    {
      provide: SIGNATURE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SignatureDriver => {
        const name = config.get<string>('integrations.signature.driver', 'mock');
        if (name === 'docusign') return new DocusignSignatureDriver(config);

        if (name === 'mock') {
          Logger.log(
            'Signature : driver simulé (aucun compte DocuSign branché).',
            'SignatureModule',
          );
          return new MockSignatureDriver();
        }

        throw new Error(
          `SIGNATURE_DRIVER="${name}" inconnu. Valeurs possibles : mock, docusign.`,
        );
      },
    },
  ],
  exports: [SIGNATURE_DRIVER],
})
export class SignatureModule {}
