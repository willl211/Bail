import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminPayslipAnalysis } from './admin-payslip-analysis';
import { getPayslipAnalysis, requestPayslipAnalysis } from '@/lib/admin-client';
import type { PayslipAnalysisView } from '@/lib/payslip-analysis';

jest.mock('@/lib/admin-client', () => ({
  getPayslipAnalysis: jest.fn(),
  requestPayslipAnalysis: jest.fn(),
}));
const get = getPayslipAnalysis as jest.MockedFunction<typeof getPayslipAnalysis>;
const request = requestPayslipAnalysis as jest.MockedFunction<typeof requestPayslipAnalysis>;
const base: PayslipAnalysisView = {
  documentId: 'bulletin',
  revision: 2,
  status: 'UNAVAILABLE',
  configured: false,
  message: 'L’analyse IA n’est pas activée.',
  requestedAt: null,
  completedAt: null,
  retryAfterSeconds: 0,
  canRequest: false,
  extraction: null,
  checks: [],
};
beforeEach(() => jest.resetAllMocks());

it('affiche clairement le mode désactivé sans lancer de traitement', async () => {
  get.mockResolvedValue(base);
  render(<AdminPayslipAnalysis documentId="bulletin" revision={2} />);
  expect(await screen.findByText('Analyse non activée')).toBeInTheDocument();
  expect(screen.getByText(/La validation reste votre décision/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Analyser/ })).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

it('sépare les montants, les passages justificatifs et les écarts sans proposer une validation IA', async () => {
  const field = (value: string | number, evidence: string) => ({ value, evidence, page: 1 });
  const unread = { value: null, evidence: null, page: null };
  get.mockResolvedValue({
    ...base,
    configured: true,
    status: 'COMPLETED',
    message: null,
    completedAt: '2026-09-10T10:00:00Z',
    extraction: {
      kind: 'PAYSLIP',
      warnings: [],
      employeeName: field('Awa Diallo', 'Awa Diallo'),
      employerName: unread,
      periodStart: unread,
      periodEnd: unread,
      netBeforeTaxCents: field(200000, 'NET AVANT IMPOT 2 000,00'),
      netPaidCents: field(190000, 'NET PAYE 1 900,00'),
      netTaxableCents: unread,
    },
    checks: [
      {
        code: 'INCOME',
        tone: 'attention',
        label: 'Revenu à comparer',
        detail: 'Le montant déclaré diffère du montant lu.',
      },
    ],
  });
  render(<AdminPayslipAnalysis documentId="bulletin" revision={2} />);
  expect(await screen.findByText('Lecture disponible')).toBeInTheDocument();
  expect(screen.getByText(/2\s000,00\s€/)).toBeInTheDocument();
  expect(screen.getByText(/1\s900,00\s€/)).toBeInTheDocument();
  expect(screen.getAllByText('Non lu')).toHaveLength(4);
  await userEvent.click(screen.getByText('Voir les passages lus dans le document'));
  expect(screen.getByText('NET AVANT IMPOT 2 000,00')).toBeVisible();
  expect(screen.getByText('Le montant déclaré diffère du montant lu.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Valider/ })).not.toBeInTheDocument();
});

it('relance uniquement sur demande explicite avec la version courante', async () => {
  const failed: PayslipAnalysisView = {
    ...base,
    configured: true,
    status: 'FAILED',
    canRequest: true,
  };
  const queued: PayslipAnalysisView = {
    ...base,
    configured: true,
    status: 'QUEUED',
    message: null,
  };
  get.mockResolvedValueOnce(failed).mockResolvedValue(queued);
  request.mockResolvedValue(queued);
  render(<AdminPayslipAnalysis documentId="bulletin" revision={2} />);
  const button = await screen.findByRole('button', { name: 'Relancer la lecture' });
  expect(request).not.toHaveBeenCalled();
  await userEvent.click(button);
  expect(request).toHaveBeenCalledWith('bulletin', 2);
  expect(await screen.findByText('En attente')).toBeInTheDocument();
});

it('annule la lecture précédente et ignore son retour tardif en changeant de pièce', async () => {
  let finish!: (data: PayslipAnalysisView) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<AdminPayslipAnalysis key="old" documentId="old" revision={1} />);
  const signal = get.mock.calls[0][2];
  get.mockResolvedValue({ ...base, documentId: 'new' });
  view.rerender(<AdminPayslipAnalysis key="new" documentId="new" revision={2} />);
  await screen.findByText('Analyse non activée');
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ ...base, status: 'COMPLETED' }));
  expect(screen.queryByText('Lecture disponible')).not.toBeInTheDocument();
});

it('conserve un message de conflit et permet de réessayer la lecture', async () => {
  get
    .mockRejectedValueOnce({ message: 'Le dossier a changé. Actualisez la page.' })
    .mockResolvedValue(base);
  render(<AdminPayslipAnalysis documentId="bulletin" revision={2} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Le dossier a changé');
  await userEvent.click(screen.getByRole('button', { name: 'Actualiser l’analyse' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(request).not.toHaveBeenCalled();
});
