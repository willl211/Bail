import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OwnerAccountForm } from './owner-account-form';
import { EmailChangeConfirmation } from './email-change-confirmation';
import { saveOwnerContact } from '@/lib/owner-profile-client';
import { requestEmailChange, confirmEmailChange } from '@/lib/auth-client';
import { routerMock } from '../test/setup-components';
import type { CurrentUser } from '@/lib/api';

jest.mock('@/lib/owner-profile-client', () => ({ saveOwnerContact: jest.fn() }));
jest.mock('@/lib/auth-client', () => ({
  requestEmailChange: jest.fn(),
  confirmEmailChange: jest.fn(),
}));
const user: CurrentUser = {
  id: 'owner',
  email: 'owner@exemple.test',
  role: 'OWNER',
  firstName: 'Sylvie',
  lastName: 'Kremer',
  phone: null,
  emailVerified: true,
  createdAt: '2026-09-01T10:00:00Z',
};

describe('Informations du compte propriétaire', () => {
  it('enregistre les coordonnées et rafraîchit l’identité affichée', async () => {
    jest
      .mocked(saveOwnerContact)
      .mockResolvedValue({ ...user, lastName: 'Martin', phone: '+33612345678' });
    render(<OwnerAccountForm user={user} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Nom' }), {
      target: { value: 'Martin' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Téléphone/ }), {
      target: { value: '+33612345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer mes informations' }));
    await waitFor(() =>
      expect(saveOwnerContact).toHaveBeenCalledWith({
        firstName: 'Sylvie',
        lastName: 'Martin',
        phone: '+33612345678',
      }),
    );
    expect(await screen.findByText('Informations enregistrées')).toBeInTheDocument();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('garde l’adresse actuelle et efface le mot de passe après la demande', async () => {
    jest.mocked(requestEmailChange).mockResolvedValue(undefined);
    render(<OwnerAccountForm user={user} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Nouvelle adresse e-mail' }), {
      target: { value: 'NEW@exemple.test' },
    });
    fireEvent.change(screen.getByLabelText(/Mot de passe actuel/), {
      target: { value: 'mon-mot-de-passe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer ma nouvelle adresse' }));
    await waitFor(() =>
      expect(requestEmailChange).toHaveBeenCalledWith('new@exemple.test', 'mon-mot-de-passe'),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Votre adresse actuelle reste active',
    );
    expect(screen.getByLabelText(/Mot de passe actuel/)).toHaveValue('');
    expect(screen.getByText(user.email)).toBeInTheDocument();
  });

  it('affiche le refus du serveur sans annoncer un enregistrement réussi', async () => {
    jest.mocked(saveOwnerContact).mockRejectedValue({ message: 'Téléphone invalide.' });
    render(<OwnerAccountForm user={user} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer mes informations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Téléphone invalide.');
    expect(screen.queryByText('Informations enregistrées')).not.toBeInTheDocument();
  });

  it('attend un clic explicite pour confirmer un changement d’adresse', async () => {
    jest.mocked(confirmEmailChange).mockResolvedValue({ email: 'new@exemple.test' });
    render(<EmailChangeConfirmation token="test-token" />);
    expect(confirmEmailChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le changement' }));
    expect(await screen.findByText('Votre adresse a été modifiée')).toBeInTheDocument();
    expect(confirmEmailChange).toHaveBeenCalledWith('test-token');
    expect(screen.getByRole('link', { name: 'Me reconnecter' })).toHaveAttribute(
      'href',
      '/connexion',
    );
  });
});
