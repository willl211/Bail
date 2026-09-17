'use client';

export function redirectToStripe(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Le lien de paiement est invalide. Veuillez réessayer.');
  }
  window.location.assign(url.toString());
}
