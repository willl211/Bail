import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  CustomerInput,
  DriverPaymentIntent,
  DriverSubscription,
  PaymentDriver,
  SubscriptionInput,
  WebhookEvent,
} from './payment.driver';

/**
 * Prestataire Stripe.
 *
 * Écrit en entier, mais **inactif tant qu'aucun compte n'est branché** : le
 * driver par défaut reste `mock` (docs/integrations.md). Passer en réel demande
 * `PAYMENT_DRIVER=stripe`, `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` — pas
 * une ligne de code métier.
 *
 * Le *produit* vient du catalogue Stripe (`STRIPE_PRODUCT_ID`, créé une fois) ;
 * le *prix*, lui, est construit à chaque souscription à partir du barème en
 * base. C'est ce qui permet de changer le tarif sans redéploiement ni
 * intervention dans le tableau de bord (docs/legal-context.md).
 */
@Injectable()
export class StripePaymentDriver implements PaymentDriver {
  readonly name = 'stripe';

  private readonly logger = new Logger(StripePaymentDriver.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string | undefined;
  private readonly productId: string;

  constructor(config: ConfigService) {
    // Échouer au démarrage, pas à la première transaction : une configuration
    // incomplète découverte au moment d'encaisser serait bien pire.
    const key = config.get<string>('integrations.payment.stripe.secretKey');
    const productId = config.get<string>('integrations.payment.stripe.productId');
    const missing = [
      key ? null : 'STRIPE_SECRET_KEY',
      productId ? null : 'STRIPE_PRODUCT_ID',
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(
        `PAYMENT_DRIVER=stripe exige ${missing.join(' et ')}. Repassez à PAYMENT_DRIVER=mock tant qu’aucun compte n’est branché.`,
      );
    }

    this.stripe = new Stripe(key as string);
    this.productId = productId as string;
    this.webhookSecret = config.get<string>('integrations.payment.stripe.webhookSecret');
  }

  private static toStatus(status: Stripe.Subscription.Status): DriverSubscription['status'] {
    switch (status) {
      case 'trialing':
        return 'trialing';
      case 'active':
        return 'active';
      case 'past_due':
      case 'unpaid':
        return 'past_due';
      default:
        return 'canceled';
    }
  }

  private static toDriverSubscription(subscription: Stripe.Subscription): DriverSubscription {
    const item = subscription.items.data[0];
    return {
      id: subscription.id,
      customerId:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id,
      status: StripePaymentDriver.toStatus(subscription.status),
      currentPeriodEnd: new Date(item.current_period_end * 1000),
      quantity: item.quantity ?? 0,
    };
  }

  async createCustomer(input: CustomerInput): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({
      email: input.email,
      name: input.name,
      // L'identifiant interne voyage en métadonnée : c'est ce qui permet de
      // rattacher un webhook à un compte sans dépendre de l'e-mail, qui peut
      // changer.
      metadata: { userId: input.userId },
    });
    return { id: customer.id };
  }

  async createSubscription(input: SubscriptionInput): Promise<DriverSubscription> {
    const subscription = await this.stripe.subscriptions.create({
      customer: input.customerId,
      // Reprise sur la facture : le produit est générique, c'est ce libellé qui
      // dit au propriétaire ce qu'il paie.
      description: input.label,
      items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            product: this.productId,
            unit_amount: input.unitAmountCents,
            recurring: { interval: 'month' },
          },
          quantity: input.quantity,
        },
      ],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    this.logger.log(`Abonnement Stripe créé : ${subscription.id}`);
    return StripePaymentDriver.toDriverSubscription(subscription);
  }

  async updateSubscriptionQuantity(
    subscriptionId: string,
    quantity: number,
  ): Promise<DriverSubscription> {
    const current = await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = current.items.data[0];
    if (!item) throw new BadRequestException('Abonnement sans ligne facturable.');

    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, quantity }],
      // Le prorata est laissé à Stripe : ajouter un bien en cours de mois ne
      // doit facturer que la fraction restante.
      proration_behavior: 'create_prorations',
    });

    return StripePaymentDriver.toDriverSubscription(updated);
  }

  async cancelSubscription(
    subscriptionId: string,
    atPeriodEnd = true,
  ): Promise<DriverSubscription> {
    const subscription = atPeriodEnd
      ? await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
      : await this.stripe.subscriptions.cancel(subscriptionId);

    return StripePaymentDriver.toDriverSubscription(subscription);
  }

  async createPaymentIntent(input: {
    amountCents: number;
    currency: string;
    customerId?: string;
    description: string;
    metadata?: Record<string, string>;
  }): Promise<DriverPaymentIntent> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      customer: input.customerId,
      description: input.description,
      metadata: input.metadata,
      automatic_payment_methods: { enabled: true },
    });

    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      status:
        intent.status === 'succeeded'
          ? 'succeeded'
          : intent.status === 'requires_action'
            ? 'requires_action'
            : 'requires_payment_method',
      amountCents: intent.amount,
    };
  }

  parseWebhook(payload: Buffer, signature: string | undefined): WebhookEvent {
    if (!this.webhookSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET absent : webhook refusé.');
    }
    if (!signature) {
      throw new BadRequestException('Signature de webhook manquante.');
    }

    let event: Stripe.Event;
    try {
      // Vérification obligatoire : sans elle, n'importe qui pourrait déclarer
      // un paiement réussi en appelant l'endpoint.
      event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    } catch (error) {
      this.logger.warn(`Signature de webhook invalide : ${(error as Error).message}`);
      throw new BadRequestException('Signature de webhook invalide.');
    }

    return {
      id: event.id,
      type: event.type,
      data: event.data.object as unknown as Record<string, unknown>,
    };
  }
}
