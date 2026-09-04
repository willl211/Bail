import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailConfirmation } from './email-confirmation';
import { confirmEmail, resendVerification } from '@/lib/auth-client';

jest.mock('@/lib/auth-client', () => ({
  confirmEmail: jest.fn(),
  resendVerification: jest.fn(),
}));

const mockConfirm = confirmEmail as jest.MockedFunction<typeof confirmEmail>;
const mockResend = resendVerification as jest.MockedFunction<typeof resendVerification>;

/**
 * Écran de confirmation d'adresse.
 *
 * Deux comportements y sont subtils et invisibles à la relecture, d'où ces
 * tests : le jeton ne doit être consommé **qu'une fois** malgré le double
 * montage de React en développement, et il doit disparaître de la barre
 * d'adresse dès qu'il a servi — un lien copié depuis l'historique ne doit pas
 * circuler.
 */
describe('EmailConfirmation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/verification-email?jeton=abc');
  });

  it('confirme dès l’affichage, sans demander un second clic', async () => {
    // Le destinataire a déjà cliqué une fois, dans son courrier : lui demander
    // de confirmer sa confirmation n'apporte rien.
    mockConfirm.mockResolvedValue({ email: 'awa@bail.test' });

    render(<EmailConfirmation token="jeton-valide" />);

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('jeton-valide'));
    expect(await screen.findByText(/C’est fait/)).toBeInTheDocument();
    expect(screen.getByText('awa@bail.test')).toBeInTheDocument();
  });

  it('ne consomme le jeton qu’une fois en mode strict', async () => {
    // React monte deux fois en mode strict — ce que fait Next en développement.
    // Sans garde, le jeton, à usage unique, serait consommé au premier appel et
    // l'écran afficherait l'échec du second. Le mode strict est donc reproduit
    // ici : c'est la seule façon de vérifier ce garde-fou.
    mockConfirm.mockResolvedValue({ email: 'awa@bail.test' });

    render(
      <StrictMode>
        <EmailConfirmation token="jeton-valide" />
      </StrictMode>,
    );

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/C’est fait/)).toBeInTheDocument();
  });

  it('retire le jeton de la barre d’adresse une fois utilisé', async () => {
    mockConfirm.mockResolvedValue({ email: 'awa@bail.test' });

    render(<EmailConfirmation token="jeton-valide" />);

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(window.location.pathname).toBe('/verification-email');
  });

  it('propose un nouveau lien quand celui-ci a expiré', async () => {
    mockConfirm.mockRejectedValue({ message: 'Ce lien n’est plus valable.' });
    mockResend.mockResolvedValue(undefined);

    render(<EmailConfirmation token="jeton-perime" />);

    expect(await screen.findByText('Ce lien n’est plus valable.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /nouveau lien/i }));

    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Envoyé')).toBeInTheDocument();
  });

  it('n’appelle rien quand le lien est incomplet', async () => {
    // Une URL tronquée à la recopie ne doit pas déclencher d'appel inutile.
    render(<EmailConfirmation token={null} />);

    expect(await screen.findByText(/lien est incomplet/i)).toBeInTheDocument();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('affiche l’échec d’un renvoi sans masquer l’écran', async () => {
    mockConfirm.mockRejectedValue({ message: 'Lien expiré.' });
    mockResend.mockRejectedValue({ message: 'Un lien vient de vous être envoyé.' });

    render(<EmailConfirmation token="jeton-perime" />);
    await screen.findByText('Lien expiré.');

    await userEvent.click(screen.getByRole('button', { name: /nouveau lien/i }));

    expect(
      await screen.findByText('Un lien vient de vous être envoyé.'),
    ).toBeInTheDocument();
    // Le bouton reste disponible : l'utilisateur doit pouvoir réessayer.
    expect(screen.getByRole('button', { name: /nouveau lien/i })).toBeEnabled();
  });
});
