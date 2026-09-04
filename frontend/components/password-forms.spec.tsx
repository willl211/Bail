import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm, ResetPasswordForm } from './password-forms';
import { forgotPassword, resetPassword } from '@/lib/auth-client';

jest.mock('@/lib/auth-client', () => ({
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
}));

const mockForgot = forgotPassword as jest.MockedFunction<typeof forgotPassword>;
const mockReset = resetPassword as jest.MockedFunction<typeof resetPassword>;

describe('ForgotPasswordForm', () => {
  it('affiche le même écran quelle que soit l’adresse saisie', async () => {
    // C'est la propriété qui empêche ce formulaire public de devenir un
    // annuaire des clients de Bail. Elle se vérifie ici, côté écran, autant que
    // dans la réponse de l'API.
    mockForgot.mockResolvedValue(undefined);

    const rendu = async (email: string) => {
      const { unmount } = render(<ForgotPasswordForm />);
      await userEvent.type(screen.getByLabelText(/adresse e-mail/i), email);
      await userEvent.click(screen.getByRole('button', { name: /m’envoyer un lien/i }));
      const texte = (await screen.findByText(/Si un compte existe/)).textContent ?? '';
      unmount();
      return texte.replace(email, '<adresse>');
    };

    expect(await rendu('connu@bail.test')).toBe(await rendu('inconnu@bail.test'));
  });

  it('formule la confirmation au conditionnel', async () => {
    // « Un lien vous a été envoyé » serait un mensonge pour une adresse sans
    // compte ; « si un compte existe » ne l'est pour personne.
    mockForgot.mockResolvedValue(undefined);

    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText(/adresse e-mail/i), 'awa@bail.test');
    await userEvent.click(screen.getByRole('button', { name: /m’envoyer un lien/i }));

    expect(await screen.findByText(/Si un compte existe/)).toBeInTheDocument();
  });

  it('affiche l’erreur et laisse réessayer si le service est injoignable', async () => {
    mockForgot.mockRejectedValue({ message: 'Impossible de joindre le service.' });

    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText(/adresse e-mail/i), 'awa@bail.test');
    await userEvent.click(screen.getByRole('button', { name: /m’envoyer un lien/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre le service.',
    );
    expect(screen.getByRole('button', { name: /m’envoyer un lien/i })).toBeEnabled();
  });
});

describe('ResetPasswordForm', () => {
  const saisir = async (mdp: string, confirmation: string) => {
    await userEvent.type(screen.getByLabelText(/nouveau mot de passe/i), mdp);
    await userEvent.type(screen.getByLabelText(/confirmation/i), confirmation);
  };

  it('vérifie la concordance avant d’appeler l’API', async () => {
    // Décisif : le jeton ne sert qu'une fois. Une faute de frappe dans la
    // confirmation ne doit pas le consommer et forcer à redemander un lien.
    render(<ResetPasswordForm token="jeton-valide" />);

    await saisir('MotDePasseChoisi2026', 'MotDePasseDifferent99');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /ne correspondent pas/i,
    );
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('envoie le jeton et le mot de passe quand tout concorde', async () => {
    mockReset.mockResolvedValue(undefined);

    render(<ResetPasswordForm token="jeton-valide" />);
    await saisir('MotDePasseChoisi2026', 'MotDePasseChoisi2026');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith('jeton-valide', 'MotDePasseChoisi2026'),
    );
  });

  it('annonce la fermeture des sessions plutôt que de connecter', async () => {
    // On ne rouvre pas de session après coup : ce serait annuler la seule
    // protection utile si le compte était détourné.
    mockReset.mockResolvedValue(undefined);

    render(<ResetPasswordForm token="jeton-valide" />);
    await saisir('MotDePasseChoisi2026', 'MotDePasseChoisi2026');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    expect(await screen.findByText(/sessions ont été fermées/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /se connecter/i })).toBeInTheDocument();
  });

  it('n’affiche aucun champ quand le lien n’a pas de jeton', async () => {
    render(<ResetPasswordForm token={null} />);

    expect(screen.getByText(/ne peut pas être utilisé/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/nouveau mot de passe/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /demander un nouveau lien/i }),
    ).toBeInTheDocument();
  });

  it('remonte le refus de l’API sans faire croire au succès', async () => {
    mockReset.mockRejectedValue({ message: 'Ce lien n’est plus valable.' });

    render(<ResetPasswordForm token="jeton-perime" />);
    await saisir('MotDePasseChoisi2026', 'MotDePasseChoisi2026');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ce lien n’est plus valable.',
    );
    expect(screen.queryByText(/C’est fait/)).not.toBeInTheDocument();
  });
});
