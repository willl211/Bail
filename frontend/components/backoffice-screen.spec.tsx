import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackofficeScreen } from './backoffice-screen';
import { routerMock } from '../test/setup-components';
import { decideFile, decideProperty } from '@/lib/admin-client';
import type {
  AdminFileRow,
  AdminPropertyRow,
  BackofficeSummary,
  ProviderRow,
} from '@/lib/api';

jest.mock('@/lib/admin-client', () => ({
  decideDocument: jest.fn(),
  decideFile: jest.fn(),
  decideProperty: jest.fn(),
  assignVisit: jest.fn(),
}));

const mockDecideFile = decideFile as jest.MockedFunction<typeof decideFile>;
const mockDecideProperty = decideProperty as jest.MockedFunction<typeof decideProperty>;

const summary: BackofficeSummary = {
  filesToReview: 1,
  propertiesToReview: 1,
  activeLeases: 0,
  pendingPayoutCents: 0,
  onlinePropertyCount: 8,
  activeFileCount: 1,
  verifiedFileCount: 1,
  averageReviewHours: 12,
};

const providers: ProviderRow[] = [
  { key: 'kyc', label: 'KYC — identité et pièces', driver: 'mock', live: false },
];

const fileIncomplet: AdminFileRow = {
  reference: 'LOC-2026-0890',
  holderName: 'Inès Lemoine',
  initials: 'IL',
  status: 'SUBMITTED',
  verifiedCount: 6,
  requiredCount: 7,
  pendingDocuments: [],
  missingLabels: ['Revenus du garant'],
  identityVerified: true,
  incomeFlag: null,
  submittedAt: '2026-09-01T09:00:00.000Z',
};

const propertyEnAttente: AdminPropertyRow = {
  reference: 'MZ-0193',
  title: '2 pièces meublé, Outre-Seille',
  ownerName: 'Claire Vogt',
  district: 'Outre-Seille',
  status: 'PENDING_REVIEW',
  totalRentCents: 83_000,
  surfaceM2: 44,
  savedCount: 0,
  blockers: [],
  warnings: ['Photos (0 / 6)'],
  submittedAt: '2026-09-02T19:45:00.000Z',
};

function monter(overrides: Partial<Parameters<typeof BackofficeScreen>[0]> = {}) {
  return render(
    <BackofficeScreen
      summary={summary}
      providers={providers}
      files={[fileIncomplet]}
      properties={[propertyEnAttente]}
      leases={[]}
      visits={[]}
      agents={[]}
      journal={[]}
      {...overrides}
    />,
  );
}

/**
 * Registre du back-office.
 *
 * Trois comportements y engagent quelqu'un d'autre, et c'est ce qui les rend
 * dignes d'un test : un motif qui suivrait l'agent d'un onglet à l'autre
 * partirait au mauvais destinataire ; un bouton actif sur un dossier incomplet
 * promettrait une décision que l'API refusera ; et un écran qui resterait figé
 * après un refus laisserait l'agent devant un état que le serveur vient de
 * rejeter.
 */
describe('BackofficeScreen', () => {
  const onglet = (nom: RegExp) => screen.getByRole('button', { name: nom });

  it('affiche les pièces non vérifiées et désactive la validation', async () => {
    // Sans cette liste, l'agent découvrirait ce qui manque en essuyant un refus.
    monter();

    expect(screen.getByText('Revenus du garant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /valider le dossier/i })).toBeDisabled();
  });

  it('active la validation quand plus rien ne manque', () => {
    monter({
      files: [{ ...fileIncomplet, verifiedCount: 7, missingLabels: [] }],
    });

    expect(screen.getByRole('button', { name: /valider le dossier/i })).toBeEnabled();
  });

  it('exige un motif pour rejeter', async () => {
    monter({
      files: [{ ...fileIncomplet, verifiedCount: 7, missingLabels: [] }],
    });

    expect(screen.getByRole('button', { name: /^rejeter$/i })).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/motif/i),
      'Pièces incohérentes entre elles.',
    );
    expect(screen.getByRole('button', { name: /^rejeter$/i })).toBeEnabled();
  });

  it('vide le motif en changeant d’onglet', async () => {
    // Le motif de l'onglet Dossiers part au locataire, celui de l'onglet Biens
    // au propriétaire. Le reporter enverrait le mauvais texte à la mauvaise
    // personne.
    monter();

    await userEvent.type(screen.getByLabelText(/motif/i), 'Justificatif illisible.');
    await userEvent.click(onglet(/^Biens/));

    expect(screen.getByLabelText(/motif de renvoi/i)).toHaveValue('');

    await userEvent.click(onglet(/^Dossiers/));
    expect(screen.getByLabelText(/motif/i)).toHaveValue('');
  });

  it('bascule d’un onglet à l’autre', async () => {
    monter();

    // La référence apparaît deux fois dans cet onglet — dans la ligne du
    // tableau et dans le panneau de décision : c'est sa disparition complète
    // qui prouve le changement d'onglet.
    expect(screen.getAllByText('LOC-2026-0890').length).toBeGreaterThan(0);

    await userEvent.click(onglet(/^Biens/));
    expect(screen.getByText(/MZ-0193/)).toBeInTheDocument();
    expect(screen.queryAllByText('LOC-2026-0890')).toHaveLength(0);

    await userEvent.click(onglet(/^Journal/));
    expect(screen.getByText(/Aucune activité enregistrée/)).toBeInTheDocument();
    expect(screen.queryByText(/MZ-0193/)).not.toBeInTheDocument();
  });

  it('empêche de publier un bien qui a des blocages', async () => {
    monter({
      properties: [{ ...propertyEnAttente, blockers: ['DPE manquant'] }],
    });
    await userEvent.click(onglet(/^Biens/));

    const publier = screen.getByRole('button', { name: /publier/i });
    expect(publier).toBeDisabled();
    // Le motif du blocage est rappelé au survol, pas seulement dans la colonne.
    expect(publier).toHaveAttribute('title', 'DPE manquant');
  });

  it('affiche le motif renvoyé par l’API quand la décision échoue', async () => {
    // Écran périmé : deux agents, ou deux onglets. Le registre doit dire ce qui
    // s'est passé plutôt que rester figé sur un état que le serveur a refusé.
    mockDecideProperty.mockRejectedValue({
      message: 'Ce bien n’est pas en attente de contrôle.',
    });
    monter();

    await userEvent.click(onglet(/^Biens/));
    await userEvent.click(screen.getByRole('button', { name: /publier/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ce bien n’est pas en attente de contrôle.',
    );
  });

  it('détaille les blocages remontés avec le refus', async () => {
    mockDecideFile.mockRejectedValue({
      message: 'Ce dossier ne peut pas être marqué vérifié.',
      blockers: ['Revenus du garant — en attente de vérification'],
    });
    monter({ files: [{ ...fileIncomplet, verifiedCount: 7, missingLabels: [] }] });

    await userEvent.click(screen.getByRole('button', { name: /valider le dossier/i }));

    const alerte = await screen.findByRole('alert');
    expect(
      within(alerte).getByText('Revenus du garant — en attente de vérification'),
    ).toBeInTheDocument();
  });

  it('n’affiche pas le délai moyen quand rien n’a été contrôlé', () => {
    // Un chiffre inventé sur une base vide vaudrait moins qu'un tiret.
    monter({ summary: { ...summary, averageReviewHours: null } });

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/aucune pièce contrôlée/i)).toBeInTheDocument();
  });

  it('accorde le décompte des dossiers vérifiés', async () => {
    monter({ summary: { ...summary, verifiedFileCount: 1 } });
    expect(screen.getByText('dont 1 entièrement vérifié')).toBeInTheDocument();
  });

  it('annonce chaque prestataire avec son driver', () => {
    monter();
    expect(screen.getByText('mock')).toBeInTheDocument();
    expect(screen.getByText(/aucun en production/i)).toBeInTheDocument();
  });

  it('propose l’état vide quand il n’y a rien à traiter', async () => {
    monter({ files: [], properties: [], leases: [] });

    expect(screen.getByText(/Aucun dossier transmis/)).toBeInTheDocument();

    await userEvent.click(onglet(/^Baux/));
    expect(screen.getByText(/Aucun bail ouvert/)).toBeInTheDocument();
  });

  it('resynchronise l’affichage après un refus', async () => {
    mockDecideProperty.mockRejectedValue({ message: 'Conflit.' });
    monter();

    await userEvent.click(onglet(/^Biens/));
    await userEvent.click(screen.getByRole('button', { name: /publier/i }));

    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalled());
  });
});
