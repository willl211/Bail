import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockPaymentDriver } from './mock-payment.driver';
import { PAYMENT_DRIVER, type PaymentDriver } from './payment.driver';
import { StripePaymentDriver } from './stripe-payment.driver';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { PaymentWebhookController } from './webhook.controller';

/**
 * Module de paiement.
 *
 * Le driver est choisi **au démarrage**, par `PAYMENT_DRIVER`. Le reste de
 * l'application n'injecte que le jeton `PAYMENT_DRIVER` : elle ignore lequel
 * tourne. Tant qu'aucun compte Stripe n'est branché, `mock` reste la valeur par
 * défaut (docs/integrations.md).
 *
 * `@Global` parce que la facturation sera appelée depuis plusieurs modules
 * (abonnement propriétaire, honoraires locataire, dépôt de garantie) : les
 * faire tous importer PaymentsModule n'apporterait rien.
 */
@Global()
@Module({
  controllers: [SubscriptionController, PaymentWebhookController],
  providers: [
    SubscriptionService,
    {
      provide: PAYMENT_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentDriver => {
        const name = config.get<string>('integrations.payment.driver', 'mock');

        switch (name) {
          case 'stripe':
            Logger.log('Paiement : driver Stripe actif.', 'PaymentsModule');
            return new StripePaymentDriver(config);
          case 'mock':
            Logger.log(
              'Paiement : driver simulé (aucun compte Stripe branché).',
              'PaymentsModule',
            );
            return new MockPaymentDriver();
          default:
            // Un nom inconnu ne doit pas silencieusement retomber sur `mock` :
            // en production, ça encaisserait dans le vide.
            throw new Error(
              `PAYMENT_DRIVER="${name}" inconnu. Valeurs acceptées : mock, stripe.`,
            );
        }
      },
    },
  ],
  exports: [PAYMENT_DRIVER, SubscriptionService],
})
export class PaymentsModule {}
