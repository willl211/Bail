import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerifyEmailNotice } from './verify-email-notice';
import { resendVerification } from '@/lib/auth-client';

jest.mock('@/lib/auth-client', () => ({ resendVerification: jest.fn() }));

const mockResend = resendVerification as jest.MockedFunction<typeof resendVerification>;

/**
 * Rappel de confirmation d'adresse, en tête des espaces personnels.
 *
 * Ce n'est **pas** un blocage : ce qui dépend d'une adresse confirmée est
 * contrôlé là où c'est engageant — candidater, publier une annonce — pas ici.
 * Le rappel ne doit donc jamais masquer l'écran ni empêcher d'agir.
 */
describe('VerifyEmailNotice', () => {
  it('rappelle l’adresse concernée et propose un renvoi', () => {
    render(<VerifyEmailNotice email="awa@bail.test" />);

    expect(screen.getByText('awa@bail.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /renvoyer le lien/i })).toBeEnabled();
  });

  it('s’annonce comme information, pas comme alerte', () => {
    // Une adresse à confirmer n'est pas une erreur : `role="status"` ne
    // détourne pas l'attention d'un lecteur d'écran en pleine saisie.
    render(<VerifyEmailNotice email="awa@bail.test" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('confirme l’envoi et retire le bouton', async () => {
    mockResend.mockResolvedValue(undefined);

    render(<VerifyEmailNotice email="awa@bail.test" />);
    await userEvent.click(screen.getByRole('button', { name: /renvoyer le lien/i }));

    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Envoyé')).toBeInTheDocument();
    // Reproposer le renvoi inviterait à s'y reprendre, alors que le plafond
    // horaire refuserait le troisième.
    expect(
      screen.queryByRole('button', { name: /renvoyer le lien/i }),
    ).not.toBeInTheDocument();
  });

  it('désactive le bouton pendant l’envoi', async () => {
    let resoudre: () => void = () => {};
    mockResend.mockImplementation(
      () => new Promise<void>((resolve) => (resoudre = resolve)),
    );

    render(<VerifyEmailNotice email="awa@bail.test" />);
    await userEvent.click(screen.getByRole('button', { name: /renvoyer le lien/i }));

    expect(screen.getByRole('button', { name: /envoi/i })).toBeDisabled();
    resoudre();
    await screen.findByText('Envoyé');
  });

  it('affiche le refus du plafond horaire et rend la main', async () => {
    mockResend.mockRejectedValue({
      message: 'Un lien de confirmation vient de vous être envoyé.',
    });

    render(<VerifyEmailNotice email="awa@bail.test" />);
    await userEvent.click(screen.getByRole('button', { name: /renvoyer le lien/i }));

    expect(
      await screen.findByText('Un lien de confirmation vient de vous être envoyé.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /renvoyer le lien/i })).toBeEnabled();
  });
});
