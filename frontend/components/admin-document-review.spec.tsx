import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminDocumentReview, type ReviewDocument } from './admin-document-review';
import { loadAdminDocument } from '@/lib/admin-client';

jest.mock('@/lib/admin-client', () => ({ loadAdminDocument: jest.fn() }));
const load = loadAdminDocument as jest.MockedFunction<typeof loadAdminDocument>;
const dpe: ReviewDocument = {
  id: 'dpe',
  label: 'DPE',
  type: 'DPE',
  status: 'PENDING',
  fileName: 'dpe.pdf',
  hasFile: true,
  note: null,
};

beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:diagnostic');
  URL.revokeObjectURL = jest.fn();
});

it('demande la lecture, les dates et la classe du DPE avant de transmettre la décision', async () => {
  load.mockResolvedValue(new Blob(['PDF'], { type: 'application/pdf' }));
  const decide = jest.fn().mockResolvedValue(undefined);
  render(
    <AdminDocumentReview documents={[dpe]} kind="property" revision={4} onDecision={decide} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Consulter le document' }));
  await userEvent.click(await screen.findByRole('checkbox'));
  const validate = screen.getByRole('button', { name: 'Valider cette pièce' });
  expect(validate).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Réalisé le/), { target: { value: '2026-01-10' } });
  fireEvent.change(screen.getByLabelText(/Valable jusqu/), { target: { value: '2030-01-10' } });
  await userEvent.selectOptions(screen.getByLabelText(/Classe lue/), 'C');
  expect(validate).toBeEnabled();
  await userEvent.click(validate);
  expect(decide).toHaveBeenCalledWith('dpe', {
    decision: 'VERIFY',
    issuedAt: '2026-01-10',
    expiresAt: '2030-01-10',
    energyRating: 'C',
    reason: undefined,
  });
});

it('empêche la validation après une erreur de lecture mais permet un refus motivé', async () => {
  load.mockRejectedValue({ message: 'Fichier introuvable' });
  const decide = jest.fn().mockResolvedValue(undefined);
  render(
    <AdminDocumentReview documents={[dpe]} kind="property" revision={4} onDecision={decide} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Consulter le document' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Fichier introuvable');
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Valider cette pièce' })).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText(/Motif de refus/),
    'Merci de déposer un fichier lisible',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Refuser cette pièce' }));
  expect(decide).toHaveBeenCalledWith('dpe', {
    decision: 'REJECT',
    reason: 'Merci de déposer un fichier lisible',
  });
});

it('efface le motif, la confirmation et le fichier consulté en changeant de pièce', async () => {
  load.mockResolvedValue(new Blob(['PDF'], { type: 'application/pdf' }));
  render(
    <AdminDocumentReview
      documents={[dpe, { ...dpe, id: 'erp', type: 'ERP', label: 'ERP' }]}
      kind="property"
      revision={4}
      onDecision={jest.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Consulter le document' }));
  await userEvent.click(await screen.findByRole('checkbox'));
  await userEvent.type(screen.getByLabelText(/Motif de refus/), 'Motif pour le DPE uniquement');
  await userEvent.selectOptions(screen.getByLabelText(/Document à examiner/), 'erp');
  expect(screen.getByLabelText(/Motif de refus/)).toHaveValue('');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.queryByRole('link', { name: /Ouvrir en grand/ })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:diagnostic');
});
