import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PropertyForm } from './property-form';
import { createDraft } from '@/lib/owner-client';

jest.mock('@/lib/owner-client', () => ({ createDraft: jest.fn(), updateDraft: jest.fn(), submitForReview: jest.fn() }));

it('conserve les situations inconnues et adapte les pièces attendues après saisie', async () => {
  jest.mocked(createDraft).mockResolvedValue({ reference: 'MZ-TEST' });
  render(<PropertyForm property={null} districts={[]} />);
  expect(screen.getByLabelText(/Installation de gaz de plus de 15 ans/)).toHaveValue('UNKNOWN');
  expect(screen.getByLabelText(/Logement situé dans une zone à risques/)).toHaveValue('UNKNOWN');
  fireEvent.change(screen.getByLabelText(/Année de construction/), { target: { value: '1940' } });
  fireEvent.change(screen.getByLabelText(/Installation de gaz de plus de 15 ans/), { target: { value: 'REQUIRED' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
  await waitFor(() => expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
    constructionYear: 1940, gasDiagnostic: 'REQUIRED', riskDiagnostic: 'UNKNOWN',
    noiseDiagnostic: 'UNKNOWN', electricalDiagnostic: 'UNKNOWN',
  })));
  await screen.findByText('Brouillon enregistré');
  expect(screen.getByText('Installation gaz').closest('.doc-row')).toHaveTextContent('requis');
  expect(screen.getByText('Plomb (CREP)').closest('.doc-row')).toHaveTextContent('requis');
  expect(screen.getByText('Installation électrique').closest('.doc-row')).not.toHaveTextContent('requis');
});
