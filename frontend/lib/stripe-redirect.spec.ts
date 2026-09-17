import { redirectToStripe } from './stripe-redirect';

describe('Destination des paiements', () => {
  it.each(['https://checkout.stripe.com.evil.test/pay', 'https://evil.test', 'http://checkout.stripe.com/pay', 'javascript:alert(1)', 'https://user:secret@checkout.stripe.com/pay'])(
    'refuse une destination inattendue : %s', value => {
      expect(() => redirectToStripe(value)).toThrow();
    },
  );
});
