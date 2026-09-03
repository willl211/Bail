import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/session.guard';
import { PAYMENT_DRIVER, type PaymentDriver } from './payment.driver';
import { SubscriptionService } from './subscription.service';

/**
 * Réception des événements du prestataire de paiement.
 *
 * Route publique — elle est appelée par le prestataire, pas par un navigateur
 * porteur de session. C'est **la signature** qui l'authentifie, rien d'autre :
 * sans elle, n'importe qui pourrait déclarer un paiement réussi.
 *
 * La vérification exige la charge **brute**, octet pour octet : le JSON reparsé
 * puis re-sérialisé par Express ne produit pas la même empreinte. D'où
 * `rawBody: true` au démarrage (voir `main.ts`).
 */
@Controller('payments/webhook')
@Public()
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    @Inject(PAYMENT_DRIVER) private readonly driver: PaymentDriver,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const payload = request.rawBody;
    if (!payload) {
      throw new BadRequestException('Charge brute absente : signature invérifiable.');
    }

    const event = this.driver.parseWebhook(payload, signature);
    this.logger.log(`Événement ${event.type} (${event.id})`);

    // Répondre 200 même sur un événement ignoré : un 4xx ferait rejouer
    // indéfiniment un type dont on n'a que faire.
    const handled = await this.subscriptions.handleWebhook(event);
    return { received: true, handled };
  }
}
