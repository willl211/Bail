/**
 * Contrat du prestataire de paiement.
 *
 * Toute la logique métier passe par cette interface — jamais par Stripe
 * directement. C'est ce qui permet de construire l'intégralité du module de
 * paiement sans compte Stripe branché : `mock` répond en développement, et
 * passer en production ne demande que de changer `PAYMENT_DRIVER` et les clés
 * (docs/integrations.md).
 *
 * Si une évolution oblige à toucher au code métier pour brancher Stripe, c'est
 * que cette abstraction est mauvaise et qu'il faut la corriger, pas la
 * contourner.
 */

export interface CustomerInput {
  email: string;
  name: string;
  /** Identifiant interne, retrouvé tel quel dans les métadonnées Stripe. */
  userId: string;
}

export interface SubscriptionInput {
  customerId: string;
  /** Montant unitaire mensuel, en centimes. Vient du barème, jamais du code. */
  unitAmountCents: number;
  /**
   * Nombre de biens diffusés : c'est l'assiette de facturation. Zéro est
   * valide — un propriétaire abonné sans annonce en ligne paie zéro.
   */
  quantity: number;
  currency: string;
  label: string;
}

export interface DriverSubscription {
  id: string;
  customerId: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: Date;
  quantity: number;
}

export interface DriverPaymentIntent {
  id: string;
  clientSecret: string | null;
  status: 'requires_payment_method' | 'requires_action' | 'succeeded' | 'failed';
  amountCents: number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  /** Objet concerné, forme propre au prestataire. */
  data: Record<string, unknown>;
}

export const PAYMENT_DRIVER = Symbol('PAYMENT_DRIVER');

export interface PaymentDriver {
  /** Nom du driver, exposé par `/health` pour savoir ce qui tourne. */
  readonly name: string;

  createCustomer(input: CustomerInput): Promise<{ id: string }>;

  createSubscription(input: SubscriptionInput): Promise<DriverSubscription>;

  /** Change l'assiette quand un bien entre ou sort de la diffusion. */
  updateSubscriptionQuantity(
    subscriptionId: string,
    quantity: number,
  ): Promise<DriverSubscription>;

  /**
   * Résilie. `atPeriodEnd` par défaut : l'abonnement est mensuel et déjà réglé
   * jusqu'à la fin de la période, couper immédiatement priverait le
   * propriétaire de ce qu'il a payé.
   */
  cancelSubscription(subscriptionId: string, atPeriodEnd?: boolean): Promise<DriverSubscription>;

  /** Paiement unique — honoraires locataire, dépôt de garantie. */
  createPaymentIntent(input: {
    amountCents: number;
    currency: string;
    customerId?: string;
    description: string;
    metadata?: Record<string, string>;
  }): Promise<DriverPaymentIntent>;

  /**
   * Vérifie la signature d'un webhook et renvoie l'événement.
   *
   * La signature n'est pas une formalité : sans elle, n'importe qui pourrait
   * appeler l'endpoint pour déclarer un paiement réussi.
   */
  parseWebhook(payload: Buffer, signature: string | undefined): WebhookEvent;
}
