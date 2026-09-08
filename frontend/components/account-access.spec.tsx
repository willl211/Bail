import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountLoginForm } from './account-login-form';
import { AccountRegistrationForm } from './account-registration-form';
import { login, register } from '@/lib/auth-client';
import { routerMock } from '../test/setup-components';

jest.mock('@/lib/auth-client', () => ({ login: jest.fn(), register: jest.fn() }));

describe('Entrée commune du compte', () => {
  it.each([
    ['OWNER', '/proprietaires/biens'],
    ['AGENT', '/back-office'],
    ['TENANT', '/biens/MZ-0155/candidater'],
  ])(
    'connecte %s et retrouve sa destination, sans choisir de rôle',
    async (role, destination) => {
      jest.mocked(login).mockResolvedValue({ user: { id: 'demo', role } });
      render(<AccountLoginForm intent={{ candidature: 'MZ-0155' }} />);
      fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
        target: { value: 'demo@exemple.test' },
      });
      fireEvent.change(screen.getByLabelText('Mot de passe'), {
        target: { value: 'Demo1234!' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
      await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith(destination));
      expect(routerMock.refresh).toHaveBeenCalled();
    },
  );

  it('conserve le bien à sauvegarder dans la connexion et le lien d’inscription', async () => {
    jest.mocked(login).mockResolvedValue({ user: { id: 'tenant', role: 'TENANT' } });
    render(<AccountLoginForm intent={{ bien: 'MZ-0155' }} />);
    expect(screen.getByRole('link', { name: /Je cherche un logement/ })).toHaveAttribute(
      'href',
      '/dossier?bien=MZ-0155',
    );
    expect(screen.getByRole('link', { name: /Je mets un bien/ })).toHaveAttribute(
      'href',
      '/proprietaires',
    );
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'demo@exemple.test' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'Demo1234!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/biens/MZ-0155?sauvegarder=1'),
    );
  });

  it('affiche un échec de connexion et autorise une nouvelle tentative', async () => {
    jest.mocked(login).mockRejectedValue({ message: 'Identifiants incorrects.' });
    render(<AccountLoginForm />);
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'demo@exemple.test' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'incorrect' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants incorrects.');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
  });

  it.each(['OWNER', 'TENANT'] as const)(
    'crée un compte %s avec le rôle du parcours choisi',
    async (role) => {
      jest.mocked(register).mockResolvedValue({ user: { id: 'new', role } });
      render(<AccountRegistrationForm role={role} />);
      for (const [label, value] of [
        ['Prénom', 'Camille'],
        ['Nom', 'Ferry'],
        ['Adresse e-mail', 'camille@exemple.test'],
        ['Mot de passe', 'MotDePasse123!'],
      ]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      }
      fireEvent.click(screen.getByRole('button', { name: /Créer mon/ }));
      await waitFor(() =>
        expect(register).toHaveBeenCalledWith(
          expect.objectContaining({
            role,
            firstName: 'Camille',
            email: 'camille@exemple.test',
          }),
        ),
      );
      expect(routerMock.replace).toHaveBeenCalledWith(
        role === 'OWNER' ? '/proprietaires/biens' : '/dossier',
      );
    },
  );

  it('reprend une candidature après inscription et garde le même contexte dans le lien de connexion', async () => {
    jest.mocked(register).mockResolvedValue({ user: { id: 'new', role: 'TENANT' } });
    render(
      <AccountRegistrationForm
        role="TENANT"
        redirectTo="/biens/MZ-0155/candidater"
        loginHref="/connexion?candidature=MZ-0155"
      />,
    );
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute(
      'href',
      '/connexion?candidature=MZ-0155',
    );
    for (const [label, value] of [
      ['Prénom', 'Camille'],
      ['Nom', 'Ferry'],
      ['Adresse e-mail', 'camille@exemple.test'],
      ['Mot de passe', 'MotDePasse123!'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: /Créer mon/ }));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/biens/MZ-0155/candidater'),
    );
  });
});
