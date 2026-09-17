import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LogoutButton } from './logout-button';
import { logout } from '@/lib/auth-client';
import { routerMock } from '../test/setup-components';

jest.mock('@/lib/auth-client', () => ({ logout: jest.fn() }));

it('ne prétend pas fermer une session après une panne réseau et permet de réessayer', async () => {
  jest.mocked(logout).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
  render(<LogoutButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La déconnexion n’a pas abouti');
  expect(routerMock.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
