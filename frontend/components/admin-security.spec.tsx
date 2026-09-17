import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MfaScreen } from './mfa-screen';
import { PrivacyScreen } from './privacy-screen';
import { AccountLoginForm } from './account-login-form';
import { setupMfa, verifyMfa, login } from '@/lib/auth-client';
import { operationsRequest } from '@/lib/operations-client';
import { routerMock } from '../test/setup-components';

jest.mock('@/lib/auth-client', () => ({ setupMfa: jest.fn(), verifyMfa: jest.fn(), login: jest.fn(), logout: jest.fn() }));
jest.mock('@/lib/operations-client', () => ({
  ...jest.requireActual('@/lib/operations-client'), operationsRequest: jest.fn(),
}));

it('dirige une session admin incomplète vers la validation MFA', async () => {
  jest.mocked(login).mockResolvedValue({ user: { id: 'admin', role: 'AGENT', mfaRequired: true } });
  render(<AccountLoginForm />);
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'admin@example.test' } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/securite'));
});

it('demande de conserver les secours avant de quitter le premier enrôlement', async () => {
  jest.mocked(setupMfa).mockResolvedValue({ secret: 'SPECIMENSECRET', uri: 'otpauth://specimen' });
  jest.mocked(verifyMfa).mockResolvedValue({ recoveryCodes: ['specimen-secours'] });
  render(<MfaScreen enrolled={false} />);
  fireEvent.change(screen.getByLabelText('Mot de passe actuel'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Configurer mon application' }));
  expect(await screen.findByText('SPECIMENSECRET')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres de l’application'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider le code' }));
  expect(await screen.findByText('specimen-secours')).toBeInTheDocument();
  expect(screen.queryByText('SPECIMENSECRET')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ouvrir le back-office' })).toBeDisabled();
  expect(routerMock.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le back-office' }));
  expect(routerMock.replace).toHaveBeenCalledWith('/back-office');
});

it('reste sur la saisie MFA après un code refusé puis accepte une nouvelle tentative', async () => {
  jest.mocked(verifyMfa).mockRejectedValueOnce({ message: 'Code invalide ou déjà utilisé.' })
    .mockResolvedValueOnce({ recoveryCodes: [] });
  render(<MfaScreen enrolled />);
  fireEvent.change(screen.getByLabelText('Code de l’application ou code de secours'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider le code' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Code invalide');
  expect(routerMock.replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Code de l’application ou code de secours'), { target: { value: 'secours' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider le code' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/back-office'));
});

it('affiche le suivi après une demande de suppression authentifiée', async () => {
  jest.mocked(operationsRequest).mockResolvedValueOnce(null).mockResolvedValueOnce({
    id: 'request', status: 'PENDING', createdAt: '2026-09-16T12:00:00Z',
  });
  render(<PrivacyScreen />);
  await waitFor(() => expect(operationsRequest).toHaveBeenCalledWith('/privacy/erasure'));
  fireEvent.change(await screen.findByLabelText('Mot de passe actuel'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Demander la suppression' }));
  await waitFor(() => expect(screen.queryByLabelText('Mot de passe actuel')).not.toBeInTheDocument());
  expect(operationsRequest).toHaveBeenCalledWith('/privacy/erasure', { password: 'password' });
  expect(screen.getByText(/Demande du/)).toBeInTheDocument();
});

it('ne propose pas une nouvelle suppression tant que le suivi n’a pas été chargé', async () => {
  jest.mocked(operationsRequest).mockRejectedValueOnce(new Error('Connexion interrompue.'))
    .mockResolvedValueOnce({ id: 'existing', status: 'PENDING', createdAt: '2026-09-16T12:00:00Z' });
  render(<PrivacyScreen />);
  expect(screen.getByRole('status')).toHaveTextContent('Chargement');
  expect(await screen.findByRole('alert')).toHaveTextContent('Connexion interrompue');
  expect(screen.queryByLabelText('Mot de passe actuel')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText(/Demande du/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Demander la suppression' })).not.toBeInTheDocument();
});
