import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveButton } from './save-button';
import { routerMock } from '../test/setup-components';
import { saveProperty, unsaveProperty } from '@/lib/saved-client';

jest.mock('@/lib/saved-client', () => ({
  saveProperty: jest.fn(),
  unsaveProperty: jest.fn(),
}));

const mockSave = saveProperty as jest.MockedFunction<typeof saveProperty>;
const mockUnsave = unsaveProperty as jest.MockedFunction<typeof unsaveProperty>;

/**
 * Bouton « sauvegarder ».
 *
 * Trois comportements y méritent un test, parce qu'ils décident de ce que
 * l'utilisateur perd en cas d'erreur : l'anonyme ne doit pas être refoulé mais
 * conduit vers l'inscription **avec son intention**, l'état optimiste doit
 * revenir en arrière si le serveur refuse, et le clic ne doit pas déclencher la
 * navigation du lien qui l'entoure sur une carte de résultat.
 */
describe('SaveButton', () => {
  it('conduit l’anonyme vers l’inscription en gardant le bien', async () => {
    // Sauvegarder demande un compte, mais c'est précisément au moment où l'on
    // hésite : abandonner là serait perdre la personne.
    render(<SaveButton reference="MZ-0155" initiallySaved={false} role={null} />);

    await userEvent.click(screen.getByRole('button'));

    expect(routerMock.push).toHaveBeenCalledWith('/dossier?bien=MZ-0155');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('sauvegarde pour un locataire, et rafraîchit la liste', async () => {
    mockSave.mockResolvedValue(true);
    render(<SaveButton reference="MZ-0155" initiallySaved={false} role="TENANT" />);

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('MZ-0155'));
    // La liste sauvegardée est rendue côté serveur : sans ce rafraîchissement,
    // elle resterait périmée jusqu'au prochain rechargement complet.
    expect(routerMock.refresh).toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('retire un bien déjà sauvegardé', async () => {
    mockUnsave.mockResolvedValue(false);
    render(<SaveButton reference="MZ-0155" initiallySaved role="TENANT" />);

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockUnsave).toHaveBeenCalledWith('MZ-0155'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('revient en arrière si le serveur refuse', async () => {
    // L'état bascule avant la réponse pour que l'interface reste vive ; il doit
    // donc revenir, sans quoi l'utilisateur croirait avoir sauvegardé.
    mockSave.mockRejectedValue(new Error('500'));
    render(<SaveButton reference="MZ-0155" initiallySaved={false} role="TENANT" />);

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false'),
    );
    // L'échec est dit, pas seulement subi.
    expect(screen.getByRole('button')).toHaveAttribute(
      'title',
      expect.stringContaining('impossible'),
    );
  });

  it('n’apparaît ni pour un propriétaire ni pour un agent', () => {
    // L'afficher pour le voir échouer en 403 serait une promesse en l'air.
    const { container: proprio } = render(
      <SaveButton reference="MZ-0155" initiallySaved={false} role="OWNER" />,
    );
    expect(proprio).toBeEmptyDOMElement();

    const { container: agent } = render(
      <SaveButton reference="MZ-0155" initiallySaved={false} role="AGENT" />,
    );
    expect(agent).toBeEmptyDOMElement();
  });

  it('n’entraîne pas la navigation du lien qui l’entoure', async () => {
    // Sur une carte de résultat, le bouton est à l'intérieur du lien vers la
    // fiche : sans interception, sauvegarder ferait aussi quitter la page.
    mockSave.mockResolvedValue(true);
    const onNavigate = jest.fn((event: React.MouseEvent) => event.preventDefault());

    render(
      // Adresse volontairement hors application : la règle Next impose `Link`
      // pour une route interne, or c'est bien une ancre nue qu'on veut ici —
      // c'est elle qui reproduit la carte de résultat.
      <a href="https://exemple.invalid/biens/MZ-0155" onClick={onNavigate}>
        <SaveButton
          reference="MZ-0155"
          initiallySaved={false}
          role="TENANT"
          variant="icon"
        />
      </a>,
    );

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('sauvegarde sans clic au retour d’inscription', async () => {
    // L'intention a déjà été exprimée avant la création du compte : la
    // redemander reviendrait à la faire payer deux fois.
    mockSave.mockResolvedValue(true);
    render(
      <SaveButton reference="MZ-0155" initiallySaved={false} role="TENANT" autoSave />,
    );

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('MZ-0155'));
    expect(await screen.findByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('ne sauvegarde pas automatiquement un bien déjà mis de côté', async () => {
    render(<SaveButton reference="MZ-0155" initiallySaved role="TENANT" autoSave />);

    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    expect(mockSave).not.toHaveBeenCalled();
  });
});
