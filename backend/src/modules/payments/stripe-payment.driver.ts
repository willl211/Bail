import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  CustomerInput,
  CheckoutInput,
  DriverCheckout,
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

    if (!key?.startsWith('sk_test_') && !key?.startsWith('rk_test_')) {
      throw new Error('Le développement des paiements exige une clé Stripe sandbox (test).');
    }
    if (!config.get<string>('integrations.payment.stripe.webhookSecret')) {
      throw new Error('STRIPE_WEBHOOK_SECRET est nécessaire pour confirmer les paiements.');
    }

    this.stripe = new Stripe(key as string);
    this.productId = productId as string;
    this.webhookSecret = config.get<string>('integrations.payment.stripe.webhookSecret');
  }

  private static toStatus(status: Stripe.Subscription.Status): DriverSubscription['status'] {
    switch (status) {
      case 'incomplete':
        return 'incomplete';
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
      localSubscriptionId: subscription.metadata.localSubscriptionId,
      cancelledAt: subscription.cancel_at_period_end ? new Date((subscription.cancel_at ?? item.current_period_end) * 1000) : null,
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
    }, { idempotencyKey: `customer:${input.userId}` });
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
      default_payment_method: input.paymentMethodId,
      metadata: input.localSubscriptionId ? { localSubscriptionId: input.localSubscriptionId } : undefined,
    }, { idempotencyKey: input.idempotencyKey });

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
    captureMethod?: 'automatic' | 'manual';
  }): Promise<DriverPaymentIntent> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      customer: input.customerId,
      description: input.description,
      metadata: input.metadata,
      capture_method: input.captureMethod ?? 'automatic',
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

  async resumeSubscription(id: string): Promise<DriverSubscription> {
    return StripePaymentDriver.toDriverSubscription(await this.stripe.subscriptions.update(id, {
      cancel_at_period_end: false,
    }));
  }

  async retrieveSubscription(id: string): Promise<DriverSubscription> {
    return StripePaymentDriver.toDriverSubscription(await this.stripe.subscriptions.retrieve(id));
  }

  async retrieveInvoice(id: string): Promise<Record<string, unknown>> {
    return await this.stripe.invoices.retrieve(id) as unknown as Record<string, unknown>;
  }

  async createPortal(customerId: string, returnUrl: string): Promise<{ url: string }> {
    return this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  }

  private checkoutView(session: Stripe.Checkout.Session): DriverCheckout {
    const id = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id ?? null;
    if (session.status !== 'open' && session.status !== 'complete' && session.status !== 'expired') {
      throw new BadRequestException('Statut de session Stripe inconnu.');
    }
    return {
      id: session.id, url: session.url, status: session.status === 'complete' ? 'complete' : session.status === 'expired' ? 'expired' : 'open', mode: session.mode,
      checkoutId: session.metadata?.checkoutId ?? null,
      amountCents: session.amount_total, currency: session.currency,
      paid: session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
      paymentIntentId: id(session.payment_intent), subscriptionId: id(session.subscription),
      customerId: id(session.customer), setupIntentId: id(session.setup_intent),
    };
  }

  async createCheckout(input: CheckoutInput, key: string): Promise<DriverCheckout> {
    // Setup exige un client existant pour attacher sa carte avant l'abonnement à zéro bien.
    const customer = input.mode === 'setup'
      ? await this.createCustomer({ userId: input.userId, email: input.email, name: '' }) : null;
    const metadata = { checkoutId: key, localSubscriptionId: input.resourceId };
    const session = await this.stripe.checkout.sessions.create({
      mode: input.mode, customer: customer?.id,
      customer_email: customer ? undefined : input.email,
      currency: input.mode === 'setup' ? 'eur' : undefined,
      payment_method_types: ['card'], locale: 'fr',
      success_url: input.successUrl, cancel_url: input.cancelUrl,
      expires_at: input.expiresAt, metadata: { checkoutId: key },
      line_items: input.mode === 'setup' ? undefined : [{
        quantity: input.quantity,
        price_data: {
          currency: 'eur', unit_amount: input.amountCents,
          ...(input.mode === 'subscription'
            ? { product: this.productId, recurring: { interval: 'month' as const } }
            : { product_data: { name: input.label } }),
        },
      }],
      subscription_data: input.mode === 'subscription' ? { metadata } : undefined,
      payment_intent_data: input.mode === 'payment' ? { metadata: { checkoutId: key, paymentId: input.resourceId } } : undefined,
      custom_text: input.mode === 'setup' ? { submit: { message: `Abonnement : ${(input.amountCents / 100).toFixed(2)} € par mois et par bien diffusé. Aucun bien diffusé actuellement : 0 €. Carte enregistrée pour les prochaines échéances.` } } : undefined,
    }, { idempotencyKey: `checkout:${key}` });
    return this.checkoutView(session);
  }

  async retrieveCheckout(id: string): Promise<DriverCheckout> {
    return this.checkoutView(await this.stripe.checkout.sessions.retrieve(id));
  }

  async subscriptionFromCheckout(session: DriverCheckout, input: CheckoutInput, key: string): Promise<DriverSubscription> {
    if (session.subscriptionId) return this.retrieveSubscription(session.subscriptionId);
    if (input.mode !== 'setup' || !session.setupIntentId || !session.customerId) {
      throw new BadRequestException('Abonnement Stripe absent.');
    }
    const setup = await this.stripe.setupIntents.retrieve(session.setupIntentId);
    if (setup.status !== 'succeeded' || !setup.payment_method) throw new BadRequestException('Carte non confirmée.');
    const method = typeof setup.payment_method === 'string' ? setup.payment_method : setup.payment_method.id;
    return this.createSubscription({
      customerId: session.customerId, paymentMethodId: method,
      unitAmountCents: input.amountCents, quantity: 0, currency: 'EUR', label: input.label,
      idempotencyKey: `subscription:${key}`, localSubscriptionId: input.resourceId,
    });
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
    } catch {
      this.logger.warn('Signature de webhook invalide.');
      throw new BadRequestException('Signature de webhook invalide.');
    }

    if (event.livemode) throw new BadRequestException('Les événements Stripe réels sont désactivés pendant le développement.');
    return {
      id: event.id,
      type: event.type,
      data: event.data.object as unknown as Record<string, unknown>,
    };
  }
}
