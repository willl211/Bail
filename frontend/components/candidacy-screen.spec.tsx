import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CandidacyScreen } from './candidacy-screen';
import { routerMock } from '../test/setup-components';
import type { CandidacyPreview } from '@/lib/api';
import { apply } from '@/lib/applications-client';

jest.mock('@/lib/applications-client', () => ({ apply: jest.fn() }));
const mockApply = apply as jest.MockedFunction<typeof apply>;

const preview = (overrides: Partial<CandidacyPreview> = {}): CandidacyPreview => ({
  property: {
    reference: 'MZ-0155',
    title: '3 pièces, Sablon',
    district: 'Sablon',
    addressLine: '14 rue de Verdun',
    city: 'Metz',
    surfaceM2: 68,
    rooms: 3,
    energyRating: 'C',
    totalRentCents: 96_500,
    photoLabel: 'séjour',
    photoUrl: null,
    applicationCount: 7,
  },
  fees: null,
  effortRate: 0.32,
  file: {
    holderName: 'Camille Ferry',
    contractType: 'CDI',
    netMonthlyIncomeCents: 298_000,
    incomeVerified: true,
    guarantor: { label: 'Marie Ferry — 3 100 €', verified: true },
  },
  blockers: [],
  warnings: [],
  alreadyApplied: false,
  applicationStatus: null,
  averageResponseDelay: '31 h',
  ...overrides,
});

const submitButton = () => screen.getByRole('button', { name: /envoyer ma candidature/i });

/**
 * Candidature à un bien — écran 4.
 *
 * Ce qui se décide ici engage : un envoi part chez le propriétaire avec une
 * synthèse du dossier, et ne se reprend pas. Les cas tenus sont donc ceux où
 * l'écran pourrait promettre ou faire ce qu'il ne devrait pas — envoyer un
 * dossier incomplet, afficher une confirmation sur un envoi qui a échoué,
 * proposer une visite à qui n'a pas encore été retenu.
 */
describe('CandidacyScreen', () => {
  it('envoie la candidature et bascule en confirmation', async () => {
    mockApply.mockResolvedValue(
      preview({ alreadyApplied: true, applicationStatus: 'SUBMITTED' }),
    );
    render(<CandidacyScreen reference="MZ-0155" initial={preview()} applications={[]} />);

    await userEvent.click(submitButton());

    await waitFor(() => expect(mockApply).toHaveBeenCalledWith('MZ-0155', {}));
    // Ancré : « Aucune candidature envoyée pour l'instant » figure aussi sur
    // l'écran, dans le suivi.
    expect(await screen.findByText(/^Candidature envoyée\./)).toBeInTheDocument();
    // Le suivi des candidatures est rendu côté serveur : sans rafraîchissement,
    // celle qu'on vient d'envoyer manquerait au tableau juste en dessous.
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('joint le message au propriétaire quand il y en a un', async () => {
    mockApply.mockResolvedValue(preview({ alreadyApplied: true }));
    render(<CandidacyScreen reference="MZ-0155" initial={preview()} applications={[]} />);

    await userEvent.type(screen.getByRole('textbox'), 'Disponible dès le 1er octobre.');
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(mockApply).toHaveBeenCalledWith('MZ-0155', {
        message: 'Disponible dès le 1er octobre.',
      }),
    );
  });

  it('refuse l’envoi tant qu’un blocage subsiste', async () => {
    // L'API refuserait de toute façon : laisser le bouton actif ferait
    // promettre à l'écran une décision qu'il n'obtiendra pas.
    render(
      <CandidacyScreen
        reference="MZ-0155"
        initial={preview({ blockers: ['Avis d’imposition manquant'] })}
        applications={[]}
      />,
    );

    expect(submitButton()).toBeDisabled();
    expect(screen.getByText('Avis d’imposition manquant')).toBeInTheDocument();
    // Le blocage s'accompagne du moyen de le lever.
    expect(screen.getByRole('link', { name: /compléter mon dossier/i })).toHaveAttribute(
      'href',
      '/dossier',
    );
  });

  it('reste sur le formulaire quand l’envoi échoue', async () => {
    // Une confirmation affichée sur un envoi raté ferait croire à un dossier
    // parti, et personne ne le renverrait.
    mockApply.mockRejectedValue({ message: 'Votre adresse n’est pas confirmée.' });
    render(<CandidacyScreen reference="MZ-0155" initial={preview()} applications={[]} />);

    await userEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Votre adresse n’est pas confirmée.',
    );
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByText(/^Candidature envoyée\./)).not.toBeInTheDocument();
  });

  it('ne propose pas de créneau à un dossier pas encore retenu', () => {
    // L'écran de visite refuserait un candidat non retenu : lui offrir le lien
    // serait l'envoyer contre un mur.
    render(
      <CandidacyScreen
        reference="MZ-0155"
        initial={preview({ alreadyApplied: true, applicationStatus: 'SUBMITTED' })}
        applications={[]}
      />,
    );

    expect(screen.queryByRole('link', { name: /créneau/i })).not.toBeInTheDocument();
  });

  it('propose un créneau au dossier retenu', () => {
    render(
      <CandidacyScreen
        reference="MZ-0155"
        initial={preview({ alreadyApplied: true, applicationStatus: 'SHORTLISTED' })}
        applications={[]}
      />,
    );

    expect(screen.getByRole('link', { name: /choisir un créneau/i })).toHaveAttribute(
      'href',
      '/biens/MZ-0155/visite',
    );
  });

  it('renvoie vers le rendez-vous déjà pris', () => {
    render(
      <CandidacyScreen
        reference="MZ-0155"
        initial={preview({ alreadyApplied: true, applicationStatus: 'VISIT_SCHEDULED' })}
        applications={[]}
      />,
    );

    expect(screen.getByRole('link', { name: /voir mon rendez-vous/i })).toBeInTheDocument();
  });

  it('n’oppose aucune case à cocher à la transmission du dossier', async () => {
    // Transmettre la synthèse est l'objet même du service, pas un traitement
    // accessoire auquel on consentirait : une case pré-cochée aurait eu
    // l'apparence d'un consentement sans en avoir la valeur
    // (docs/legal-context.md).
    render(<CandidacyScreen reference="MZ-0155" initial={preview()} applications={[]} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText(/la synthèse ci-dessus est transmise/i)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('ne renvoie pas une candidature déjà partie', () => {
    // La contrainte d'unicité côté API le refuserait ; l'écran n'a pas à
    // proposer un geste qui ne peut qu'échouer.
    render(
      <CandidacyScreen
        reference="MZ-0155"
        initial={preview({ alreadyApplied: true, applicationStatus: 'READ' })}
        applications={[]}
      />,
    );

    expect(screen.queryByRole('button', { name: /envoyer/i })).not.toBeInTheDocument();
  });
});
