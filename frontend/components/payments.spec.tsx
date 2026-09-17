import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeesScreen } from './fees-screen';
import { SubscriptionActions } from './subscription-actions';
import { SubscriptionPortal } from './subscription-portal';
import { PaymentReturn } from './payment-return';
import { startFeePayment } from '@/lib/fees-client';
import { subscribe, openBillingPortal } from '@/lib/owner-client';
import { redirectToStripe } from '@/lib/stripe-redirect';
import { routerMock, setSearchParams } from '../test/setup-components';
import type { FeesView } from '@/lib/api';

jest.mock('@/lib/fees-client', () => ({ startFeePayment: jest.fn() }));
jest.mock('@/lib/owner-client', () => ({ subscribe: jest.fn(), cancelSubscription: jest.fn(), resumeSubscription: jest.fn(), openBillingPortal: jest.fn() }));
jest.mock('@/lib/stripe-redirect', () => ({ redirectToStripe: jest.fn() }));
const start = startFeePayment as jest.MockedFunction<typeof startFeePayment>;

const fees: FeesView = {
  leaseReference: 'BAIL-TEST', leaseStatus: 'SIGNED', propertyReference: 'MZ-TEST', propertyTitle: 'Appartement Sablon',
  surfaceM2: 50, lines: [{ key: 'drafting', label: 'Honoraires', detail: '50 m²', amountCents: 30000, legalCapCents: 40000 }],
  totalCents: 30000, ownerShareCents: 0, centsPerSqm: 600, feeScheduleCode: 'TEST', feeScheduleApproved: true, benchmark: null,
  depositCents: 70000, firstRentCents: 75000, moveInTotalCents: 175000, moveInDate: '2026-10-01',
  payment: null, blockers: [], paymentDriver: 'stripe',
};

describe('Paiements dans l’interface', () => {
  it('redirige les honoraires vers Stripe sans annoncer un paiement réussi', async () => {
    start.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/test', view: fees });
    render(<FeesScreen initial={fees} />);
    await userEvent.click(screen.getByRole('button', { name: /payer/i }));
    expect(start).toHaveBeenCalledWith('BAIL-TEST');
    expect(redirectToStripe).toHaveBeenCalledWith('https://checkout.stripe.com/test');
    expect(screen.queryByText(/Honoraires réglés/)).not.toBeInTheDocument();
  });

  it('affiche une erreur et réactive le paiement après un échec', async () => {
    start.mockRejectedValue({ message: 'Stripe temporairement indisponible.' });
    render(<FeesScreen initial={fees} />);
    await userEvent.click(screen.getByRole('button', { name: /payer/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Stripe temporairement indisponible.');
    expect(screen.getByRole('button', { name: /payer/i })).toBeEnabled();
    expect(redirectToStripe).not.toHaveBeenCalled();
  });

  it('reprend la souscription incomplète dans Stripe', async () => {
    (subscribe as jest.Mock).mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/sub' });
    render(<SubscriptionActions state="none" endsAt={null} incomplete />);
    await userEvent.click(screen.getByRole('button', { name: /reprendre dans stripe/i }));
    expect(redirectToStripe).toHaveBeenCalledWith('https://checkout.stripe.com/sub');
  });

  it('ouvre le portail de gestion de carte et de factures', async () => {
    (openBillingPortal as jest.Mock).mockResolvedValue({ url: 'https://billing.stripe.com/session' });
    render(<SubscriptionPortal />);
    await userEvent.click(screen.getByRole('button', { name: /gérer ma carte/i }));
    expect(redirectToStripe).toHaveBeenCalledWith('https://billing.stripe.com/session');
  });

  it('affiche une attente au retour et borne les actualisations', () => {
    jest.useFakeTimers(); setSearchParams('paiement=retour');
    const { unmount } = render(<PaymentReturn confirmed={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('nous attendons la confirmation');
    act(() => jest.advanceTimersByTime(60000));
    expect(routerMock.refresh).toHaveBeenCalledTimes(10);
    unmount(); jest.useRealTimers();
  });

  it('arrête l’actualisation lorsque la confirmation du serveur arrive', async () => {
    jest.useFakeTimers(); setSearchParams('paiement=retour');
    const { rerender, unmount } = render(<PaymentReturn confirmed={false} />);
    act(() => jest.advanceTimersByTime(3000));
    rerender(<PaymentReturn confirmed />);
    act(() => jest.advanceTimersByTime(15000));
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Confirmation reçue de Stripe');
    unmount(); jest.useRealTimers();
  });

  it('met à jour les honoraires depuis le nouveau statut serveur', async () => {
    const { rerender } = render(<FeesScreen initial={fees} />);
    rerender(<FeesScreen initial={{ ...fees, payment: { reference: 'HON-TEST', status: 'PAID', amountCents: 30000, paidAt: '2026-09-14' } }} />);
    await waitFor(() => expect(screen.getByText(/Honoraires réglés/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /payer/i })).not.toBeInTheDocument();
  });
});
