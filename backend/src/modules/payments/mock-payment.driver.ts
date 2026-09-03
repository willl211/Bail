import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CustomerInput,
  DriverPaymentIntent,
  DriverSubscription,
  PaymentDriver,
  SubscriptionInput,
  WebhookEvent,
} from './payment.driver';

/**
 * Prestataire simulé, actif tant qu'aucun compte Stripe n'est branché
 * (docs/integrations.md).
 *
 * Il respecte le **même contrat** que le driver Stripe : mêmes formes de
 * réponse, mêmes règles de validation, mêmes erreurs. Un mock plus permissif
 * que le vrai prestataire serait pire qu'inutile — il laisserait passer en
 * développement des cas qui casseraient en production.
 *
 * Les identifiants imitent le format Stripe (`cus_`, `sub_`, `pi_`) pour que
 * rien ne dépende involontairement de leur forme au moment de la bascule.
 */
@Injectable()
export class MockPaymentDriver implements PaymentDriver {
  readonly name = 'mock';

  private readonly logger = new Logger(MockPaymentDriver.name);

  /** État en mémoire : il disparaît au redémarrage, comme il se doit d'un mock. */
  private readonly subscriptions = new Map<string, DriverSubscription>();

  private static id(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }

  private static monthAhead(): Date {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date;
  }

  async createCustomer(input: CustomerInput): Promise<{ id: string }> {
    const id = MockPaymentDriver.id('cus');
    this.logger.log(`[mock] client créé ${id} pour ${input.email}`);
    return { id };
  }

  async createSubscription(input: SubscriptionInput): Promise<DriverSubscription> {
    // Zéro est un état légitime : un propriétaire s'abonne avant d'avoir un
    // bien diffusé, et il est alors facturé zéro. Refuser ici bloquerait le
    // parcours normal « je m'abonne, puis je publie ».
    if (input.quantity < 0) {
      throw new BadRequestException('Le nombre de biens facturés ne peut pas être négatif.');
    }
    if (input.unitAmountCents <= 0) {
      throw new BadRequestException('Le montant de l’abonnement doit être positif.');
    }

    const subscription: DriverSubscription = {
      id: MockPaymentDriver.id('sub'),
      customerId: input.customerId,
      status: 'active',
      currentPeriodEnd: MockPaymentDriver.monthAhead(),
      quantity: input.quantity,
    };

    this.subscriptions.set(subscription.id, subscription);
    this.logger.log(
      `[mock] abonnement ${subscription.id} — ${input.quantity} × ${input.unitAmountCents} c`,
    );
    return subscription;
  }

  async updateSubscriptionQuantity(
    subscriptionId: string,
    quantity: number,
  ): Promise<DriverSubscription> {
    const existing = this.subscriptions.get(subscriptionId);
    // Après un redémarrage la carte est vide : on reconstruit un état plausible
    // plutôt que d'échouer, sinon toute session de développement un peu longue
    // finirait bloquée.
    const subscription: DriverSubscription = existing ?? {
      id: subscriptionId,
      customerId: MockPaymentDriver.id('cus'),
      status: 'active',
      currentPeriodEnd: MockPaymentDriver.monthAhead(),
      quantity,
    };

    // Passer à zéro bien ne résilie pas : l'abonnement reste actif, facturé
    // zéro, jusqu'à une résiliation explicite.
    subscription.quantity = quantity;
    this.subscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  async cancelSubscription(
    subscriptionId: string,
    atPeriodEnd = true,
  ): Promise<DriverSubscription> {
    const existing = this.subscriptions.get(subscriptionId);
    const subscription: DriverSubscription = existing ?? {
      id: subscriptionId,
      customerId: MockPaymentDriver.id('cus'),
      status: 'active',
      currentPeriodEnd: MockPaymentDriver.monthAhead(),
      quantity: 0,
    };

    // `atPeriodEnd` laisse l'abonnement actif jusqu'au terme déjà payé.
    subscription.status = atPeriodEnd ? 'active' : 'canceled';
    this.subscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  async createPaymentIntent(input: {
    amountCents: number;
    currency: string;
    description: string;
  }): Promise<DriverPaymentIntent> {
    if (input.amountCents <= 0) {
      throw new BadRequestException('Le montant doit être positif.');
    }

    const id = MockPaymentDriver.id('pi');
    this.logger.log(`[mock] intention ${id} — ${input.amountCents} c — ${input.description}`);

    return {
      id,
      clientSecret: `${id}_secret_mock`,
      // Aucun paiement n'aboutit tout seul : le passage à `succeeded` reste
      // porté par un événement, comme chez le vrai prestataire.
      status: 'requires_payment_method',
      amountCents: input.amountCents,
    };
  }

  parseWebhook(payload: Buffer): WebhookEvent {
    // Pas de signature à vérifier sans prestataire réel, mais la charge doit
    // rester un JSON valide : accepter n'importe quoi masquerait des erreurs
    // de format qui exploseraient en production.
    let body: { id?: string; type?: string; data?: Record<string, unknown> };
    try {
      body = JSON.parse(payload.toString('utf8')) as typeof body;
    } catch {
      throw new BadRequestException('Charge de webhook illisible.');
    }

    if (!body.type) throw new BadRequestException('Type d’événement manquant.');

    return {
      id: body.id ?? MockPaymentDriver.id('evt'),
      type: body.type,
      data: body.data ?? {},
    };
  }
}
