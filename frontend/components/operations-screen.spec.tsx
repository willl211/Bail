import { fireEvent, render, screen } from '@testing-library/react';
import { OperationsScreen } from './operations-screen';
import { operationsRequest } from '@/lib/operations-client';

jest.mock('@/lib/operations-client', () => ({
  ...jest.requireActual('@/lib/operations-client'), operationsRequest: jest.fn(),
}));

it('permet de reprendre un chargement échoué et explicite les listes vides', async () => {
  jest.mocked(operationsRequest).mockRejectedValueOnce(new Error('Connexion interrompue.'))
    .mockResolvedValueOnce({ failedMail: 0, staleAnalysis: 0, requests: [], incidents: [], securityEvents: [] });
  render(<OperationsScreen />);
  expect(screen.getByRole('status')).toHaveTextContent('Chargement');
  expect(await screen.findByRole('alert')).toHaveTextContent('Connexion interrompue');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Aucune demande.')).toBeInTheDocument();
  expect(screen.getByText('Aucun incident enregistré.')).toBeInTheDocument();
  expect(screen.getByText('Aucun événement de sécurité enregistré.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
