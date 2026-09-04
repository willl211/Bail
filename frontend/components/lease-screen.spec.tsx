import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaseScreen } from './lease-screen';
import { routerMock } from '../test/setup-components';
import type { LeaseView } from '@/lib/api';
import { sendLeaseForSignature } from '@/lib/lease-client';

jest.mock('@/lib/lease-client', () => ({ sendLeaseForSignature: jest.fn() }));
const mockSend = sendLeaseForSignature as jest.MockedFunction<typeof sendLeaseForSignature>;

const lease = (overrides: Partial<LeaseView> = {}): LeaseView => ({
  reference: 'BAIL-2026-0007',
  status: 'FIELDS_VALIDATED',
  type: 'NU',
  propertyReference: 'MZ-0155',
  propertyTitle: '3 pièces, Sablon',
  addressLine: '14 rue de Verdun, 57000 Metz',
  templateLabel: 'Bail de location nue',
  templateCode: 'BAIL_NU_LOI_1989',
  templateVersion: 1,
  templatePublished: true,
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2029-10-01T00:00:00.000Z',
  durationMonths: 36,
  rentCents: 88_000,
  chargesCents: 8_500,
  depositCents: 88_000,
  document: [
    { heading: 1, segments: [{ text: 'CONTRAT DE LOCATION', field: null }] },
    {
      heading: 0,
      segments: [
        { text: 'Bailleur : ', field: null },
        { text: 'Sylvie Kremer', field: 'bailleurNomComplet' },
      ],
    },
  ],
  validation: {
    checks: [],
    anomalies: [],
    unverifiable: [],
    fieldCount: 18,
    missingFields: [],
    validatedAt: '2026-09-20T08:00:00.000Z',
  },
  signers: [
    { role: 'LANDLORD', fullName: 'Sylvie Kremer', signed: false, signedAt: null },
    { role: 'TENANT', fullName: 'Camille Ferry', signed: false, signedAt: null },
  ],
  annexes: [],
  history: [],
  blockers: [],
  signatureDriver: 'mock',
  sentForSignatureAt: null,
  signedAt: null,
  ...overrides,
});

const sendButton = () => screen.getByRole('button', { name: /envoyer en signature/i });

/**
 * Bail et signature — écran 6.
 *
 * Deux règles du projet se vérifient ici, et ce sont elles que la suite tient.
 * La plateforme **ne rédige aucune clause** : le document distingue à l'œil le
 * texte verrouillé du modèle des valeurs injectées, et un champ resté vide est
 * signalé, pas masqué (CLAUDE.md règle 2). Et **aucun bail ne peut partir en
 * signature** tant que le texte de l'avocat n'est pas publié : l'écran doit le
 * dire, pas laisser un bouton promettre l'inverse.
 */
describe('LeaseScreen', () => {
  it('envoie l’acte en signature et rafraîchit l’écran', async () => {
    mockSend.mockResolvedValue(
      lease({ status: 'SENT_FOR_SIGNATURE', sentForSignatureAt: '2026-09-20T09:00:00.000Z' }),
    );
    render(<LeaseScreen initial={lease()} canSend />);

    await userEvent.click(sendButton());

    await waitFor(() => expect(mockSend).toHaveBeenCalledWith('BAIL-2026-0007'));
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('refuse l’envoi tant qu’un blocage subsiste, en le nommant', () => {
    // Le cas normal aujourd'hui : le modèle légal n'est pas publié. Un bouton
    // actif promettrait un envoi que l'API refuse.
    render(
      <LeaseScreen
        initial={lease({
          blockers: [
            'Le modèle légal n’est pas publié : le texte de l’avocat n’a pas encore été fourni.',
          ],
        })}
        canSend
      />,
    );

    expect(screen.queryByRole('button', { name: /envoyer en signature/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Envoi impossible/i)).toBeInTheDocument();
    expect(screen.getByText(/texte de l’avocat/i)).toBeInTheDocument();
  });

  it('n’offre pas l’envoi au locataire', () => {
    // Seul le bailleur envoie l'acte en signature.
    render(<LeaseScreen initial={lease()} canSend={false} />);

    expect(screen.queryByRole('button', { name: /envoyer en signature/i })).not.toBeInTheDocument();
  });

  it('reste en l’état quand l’envoi échoue', async () => {
    mockSend.mockRejectedValue({ message: 'La génération de baux est désactivée.' });
    render(<LeaseScreen initial={lease()} canSend />);

    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La génération de baux est désactivée.',
    );
    expect(sendButton()).toBeEnabled();
  });

  it('distingue le texte du modèle des valeurs injectées', () => {
    // C'est ainsi que « la plateforme ne rédige aucune clause » se vérifie à
    // l'œil plutôt que d'être seulement affirmée.
    const { container } = render(<LeaseScreen initial={lease()} canSend />);

    const injecte = container.querySelector('.slotv');
    expect(injecte).toHaveTextContent('Sylvie Kremer');
    expect(injecte).toHaveAttribute('title', 'Champ injecté : bailleurNomComplet');
    // Le texte du modèle, lui, ne porte aucune marque.
    expect(screen.getByText('CONTRAT DE LOCATION').closest('.slotv')).toBeNull();
  });

  it('signale un champ resté vide au lieu de le masquer', () => {
    // Un marqueur non remplacé est un trou dans l'acte : l'effacer donnerait
    // un document qui a l'air complet.
    const { container } = render(
      <LeaseScreen
        initial={lease({
          document: [
            {
              heading: 0,
              segments: [
                { text: 'Bailleur : ', field: null },
                { text: '{{bailleurAdresse}}', field: 'bailleurAdresse' },
              ],
            },
          ],
        })}
        canSend
      />,
    );

    expect(container.querySelector('.slotv--empty')).toHaveTextContent('{{bailleurAdresse}}');
  });

  it('avertit que le prestataire de signature est simulé', () => {
    // Rien de ce qui est signé ici n'a de valeur juridique : le taire serait
    // pire que de ne rien afficher du tout.
    render(<LeaseScreen initial={lease()} canSend />);

    expect(screen.getByText('Prestataire simulé')).toBeInTheDocument();
    expect(screen.getByText(/n’a de valeur juridique/i)).toBeInTheDocument();
  });

  it('n’ouvre les honoraires qu’au locataire, et une fois l’acte signé', () => {
    // L'écran de règlement refuserait avant signature.
    const honoraires = () => screen.queryByRole('link', { name: /régler les honoraires/i });

    const { unmount } = render(
      <LeaseScreen
        initial={lease({ status: 'SENT_FOR_SIGNATURE', sentForSignatureAt: '2026-09-20T09:00:00.000Z' })}
        canSend={false}
      />,
    );
    expect(honoraires()).not.toBeInTheDocument();
    unmount();

    render(
      <LeaseScreen
        initial={lease({
          status: 'SIGNED',
          sentForSignatureAt: '2026-09-20T09:00:00.000Z',
          signedAt: '2026-09-21T09:00:00.000Z',
        })}
        canSend={false}
      />,
    );
    expect(honoraires()).toHaveAttribute('href', '/baux/BAIL-2026-0007/honoraires');
  });

  it('ne propose pas les honoraires au bailleur', () => {
    // Ils sont dus par le locataire : les lui présenter n'aurait pas de sens.
    render(
      <LeaseScreen
        initial={lease({
          status: 'SIGNED',
          sentForSignatureAt: '2026-09-20T09:00:00.000Z',
          signedAt: '2026-09-21T09:00:00.000Z',
        })}
        canSend
      />,
    );

    expect(
      screen.queryByRole('link', { name: /régler les honoraires/i }),
    ).not.toBeInTheDocument();
  });
});
