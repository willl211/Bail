import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisitBookingScreen } from './visit-booking-screen';
import { routerMock } from '../test/setup-components';
import type { VisitBookingView, VisitView } from '@/lib/api';
import { bookVisit, cancelVisit } from '@/lib/visits-client';

jest.mock('@/lib/visits-client', () => ({
  bookVisit: jest.fn(),
  cancelVisit: jest.fn(),
}));
const mockBook = bookVisit as jest.MockedFunction<typeof bookVisit>;
const mockCancel = cancelVisit as jest.MockedFunction<typeof cancelVisit>;

const visit = (overrides: Partial<VisitView> = {}): VisitView => ({
  id: 'visite-1',
  propertyReference: 'MZ-0155',
  propertyTitle: '3 pièces, Sablon',
  addressLine: '14 rue de Verdun',
  district: 'Sablon',
  type: 'ACCOMPANIED',
  status: 'CONFIRMED',
  scheduledAt: '2026-09-15T14:00:00.000Z',
  durationMinutes: 30,
  agentName: 'Léa Simon',
  videoRoomUrl: null,
  preauthorizationStatus: 'PENDING',
  preauthorizationAmountCents: null,
  cancellable: true,
  ...overrides,
});

const view = (overrides: Partial<VisitBookingView> = {}): VisitBookingView => ({
  property: {
    reference: 'MZ-0155',
    title: '3 pièces, Sablon',
    addressLine: '14 rue de Verdun',
    district: 'Sablon',
  },
  applicationStatus: 'SHORTLISTED',
  blockers: [],
  prerequisites: [],
  slots: [
    {
      id: 'creneau-accompagne',
      startsAt: '2026-09-15T14:00:00.000Z',
      durationMinutes: 30,
      allowedTypes: ['ACCOMPANIED'],
    },
    {
      id: 'creneau-mixte',
      startsAt: '2026-09-15T16:00:00.000Z',
      durationMinutes: 30,
      allowedTypes: ['ACCOMPANIED', 'VIDEO'],
    },
  ],
  visit: null,
  durations: { ACCOMPANIED: 30, VIDEO: 20 },
  cancellationDeadlineHours: 24,
  recordingRetentionDays: 15,
  drivers: { video: 'mock', payment: 'mock' },
  ...overrides,
});

const confirm = () => screen.getByRole('button', { name: /confirmer le rendez-vous/i });
/**
 * Créneau, par l'heure affichée.
 *
 * Les instants du décor sont en UTC : `14:00Z` s'affiche « 16:00 », heure de
 * Paris, que la machine de test soit à Metz ou en UTC.
 */
const slot = (label: string) => screen.getByRole('button', { name: label });

/**
 * Prise de rendez-vous — écran 5.
 *
 * Un rendez-vous engage deux personnes à se déplacer. Les cas tenus sont ceux
 * où l'écran pourrait en faire prendre un impossible : un créneau qui n'accepte
 * pas le type choisi, un dossier qui ne permet pas encore la visite, ou une
 * réservation restée sélectionnée après un échec.
 *
 * MVP v0 : accompagnée ou visio, jamais de boîtier connecté (CLAUDE.md règle 1).
 */
describe('VisitBookingScreen', () => {
  it('réserve le créneau choisi avec le type choisi', async () => {
    mockBook.mockResolvedValue(view({ visit: visit() }));
    render(<VisitBookingScreen reference="MZ-0155" initial={view()} visits={[]} />);

    await userEvent.click(slot('18:00'));
    await userEvent.click(confirm());

    await waitFor(() =>
      expect(mockBook).toHaveBeenCalledWith('MZ-0155', 'creneau-mixte', 'ACCOMPANIED'),
    );
    // Le bandeau « Vos visites » vient du rendu serveur : sans rafraîchissement,
    // le rendez-vous qu'on vient de prendre y manquerait.
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('n’offre que les deux types du MVP', () => {
    // Pas de visite autonome par boîtier connecté : c'est un point tranché,
    // pas une option à réévaluer (CLAUDE.md règle 1).
    render(<VisitBookingScreen reference="MZ-0155" initial={view()} visits={[]} />);

    expect(screen.getByText('Visite accompagnée')).toBeInTheDocument();
    expect(screen.getByText('Visite en visio')).toBeInTheDocument();
    expect(screen.queryByText(/autonome|boîtier|clé/i)).not.toBeInTheDocument();
  });

  it('désactive un créneau qui n’accepte pas le type choisi', async () => {
    render(<VisitBookingScreen reference="MZ-0155" initial={view()} visits={[]} />);

    // En visio, le créneau réservé à l'accompagnée devient inaccessible.
    await userEvent.click(screen.getByText('Visite en visio'));

    expect(slot('18:00')).toBeEnabled();
    expect(slot('16:00')).toBeDisabled();
  });

  it('relâche le créneau retenu si le type change', async () => {
    // Le créneau choisi peut ne pas accepter le nouveau type : le garder
    // ferait réserver un rendez-vous impossible.
    render(<VisitBookingScreen reference="MZ-0155" initial={view()} visits={[]} />);

    await userEvent.click(slot('16:00'));
    expect(confirm()).toBeEnabled();

    await userEvent.click(screen.getByText('Visite en visio'));

    expect(confirm()).toBeDisabled();
    expect(screen.getByText(/choisissez d’abord un créneau/i)).toBeInTheDocument();
  });

  it('n’autorise pas la confirmation sans créneau', () => {
    render(<VisitBookingScreen reference="MZ-0155" initial={view()} visits={[]} />);

    expect(confirm()).toBeDisabled();
  });

  it('ne propose aucun créneau tant que le dossier bloque', () => {
    // L'API refuserait la réservation : afficher le planning ferait choisir un
    // horaire pour rien.
    render(
      <VisitBookingScreen
        reference="MZ-0155"
        initial={view({ blockers: ['Votre candidature n’a pas encore été retenue.'] })}
        visits={[]}
      />,
    );

    expect(screen.getByText('Votre candidature n’a pas encore été retenue.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '16:00' })).not.toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    // Le blocage s'accompagne des deux moyens de le lever.
    expect(screen.getByRole('link', { name: /voir ma candidature/i })).toHaveAttribute(
      'href',
      '/biens/MZ-0155/candidater',
    );
    expect(screen.getByRole('link', { name: /compléter mon dossier/i })).toBeInTheDocument();
  });

  it('affiche l’échec sans faire croire au rendez-vous', async () => {
    mockBook.mockRejectedValue({ message: 'Ce créneau vient d’être pris.' });
    render(<VisitBookingScreen reference="MZ-0155" initial={view()} visits={[]} />);

    await userEvent.click(slot('16:00'));
    await userEvent.click(confirm());

    expect(await screen.findByRole('alert')).toHaveTextContent('Ce créneau vient d’être pris.');
    expect(screen.queryByText(/rendez-vous enregistré/i)).not.toBeInTheDocument();
  });

  describe('rendez-vous déjà pris', () => {
    it('permet de l’annuler dans le délai', async () => {
      mockCancel.mockResolvedValue([]);
      render(
        <VisitBookingScreen
          reference="MZ-0155"
          initial={view({ visit: visit() })}
          visits={[]}
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: /annuler le rendez-vous/i }));

      await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('visite-1'));
    });

    it('renvoie vers Bail une fois le délai passé', () => {
      // Le bouton mènerait à un refus de l'API : mieux vaut dire quoi faire.
      render(
        <VisitBookingScreen
          reference="MZ-0155"
          initial={view({ visit: visit({ cancellable: false }) })}
          visits={[]}
        />,
      );

      expect(
        screen.queryByRole('button', { name: /annuler le rendez-vous/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/délai d’annulation en ligne est passé/i)).toBeInTheDocument();
    });

    it('ne propose pas un lien visio de prestataire simulé', () => {
      // Les salles portent une URL en `.invalid` tant qu'aucun prestataire
      // n'est branché : offrir « Rejoindre » enverrait dans le vide.
      const { container } = render(
        <VisitBookingScreen
          reference="MZ-0155"
          initial={view({
            visit: visit({ type: 'VIDEO', videoRoomUrl: 'https://salle.invalid/abc' }),
            drivers: { video: 'mock', payment: 'mock' },
          })}
          visits={[]}
        />,
      );

      expect(screen.getByText('Prestataire simulé')).toBeInTheDocument();
      expect(container.querySelector('a[href*="invalid"]')).toBeNull();
    });

    it('ne rouvre pas le planning', () => {
      render(
        <VisitBookingScreen
          reference="MZ-0155"
          initial={view({ visit: visit() })}
          visits={[]}
        />,
      );

      expect(screen.queryByRole('button', { name: '16:00' })).not.toBeInTheDocument();
      expect(screen.getByText(/rendez-vous enregistré/i)).toBeInTheDocument();
    });
  });

  it('récapitule les visites du locataire', () => {
    render(
      <VisitBookingScreen
        reference="MZ-0155"
        initial={view()}
        visits={[visit({ status: 'CANCELLED', district: 'Queuleu' })]}
      />,
    );

    const bandeau = screen.getByText('Vos visites').closest('.panel') as HTMLElement;
    expect(within(bandeau).getByText(/annulé/i)).toBeInTheDocument();
  });
});
