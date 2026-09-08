import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchFilters, SURFACE_DEFAULT, SURFACE_MAX } from './search-filters';
import { routerMock, setSearchParams } from '../test/setup-components';

const districts = [
  { slug: 'centre-ville', name: 'Centre-ville', city: 'Metz', availableCount: 3 },
  { slug: 'sablon', name: 'Sablon', city: 'Metz', availableCount: 2 },
];

const surface = () => screen.getByLabelText(/surface habitable minimum/i);

/** Dernière adresse écrite dans l'URL, sans le chemin. */
const query = () => {
  const calls = routerMock.replace.mock.calls;
  const url = (calls[calls.length - 1]?.[0] as string) ?? '';
  return url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
};

describe('SearchFilters — critères combinés', () => {
  it('combine aussi deux changements reçus avant le prochain rendu React', () => {
    render(<SearchFilters districts={districts} />);
    act(() => {
      screen.getByRole('button', { name: 'Maison' }).click();
      screen.getByRole('button', { name: '2 pièces' }).click();
    });
    expect(Object.fromEntries(new URLSearchParams(query()))).toEqual({ propertyType: 'HOUSE', minRooms: '2', maxRooms: '2' });
  });
  it('combine les curseurs et les nouveaux critères avant le retour du serveur', async () => {
    setSearchParams('sort=recent&page=3');
    render(<SearchFilters districts={districts} />);
    fireEvent.change(screen.getByLabelText(/loyer maximum/i), { target: { value: '900' } });
    fireEvent.change(surface(), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Charges comprises' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maison' }));
    fireEvent.click(screen.getByRole('button', { name: '2 pièces' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Sablon/ }));
    const params = new URLSearchParams(query());
    expect(Object.fromEntries(params)).toEqual({ sort: 'recent', maxRent: '900', minSurface: '40', includeCharges: 'false', propertyType: 'HOUSE', minRooms: '2', maxRooms: '2', districts: 'sablon' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(new URLSearchParams(query()).get('propertyType')).toBe('HOUSE');
  });

  it('distingue deux pièces exactement et quatre pièces ou plus', () => {
    setSearchParams('minRooms=2&maxRooms=2');
    render(<SearchFilters districts={districts} />);
    expect(screen.getByRole('button', { name: '2 pièces' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '4 pièces et plus' }));
    expect(query()).toBe('minRooms=4');
    fireEvent.click(screen.getByRole('button', { name: 'Toutes les pièces' }));
    expect(query()).toBe('');
  });

  it('réinitialise aussi la temporisation, le type et les charges en conservant le tri', async () => {
    setSearchParams('propertyType=HOUSE&includeCharges=false&minRooms=4&sort=recent');
    render(<SearchFilters districts={districts} />);
    fireEvent.change(surface(), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: /réinitialiser/i }));
    expect(screen.getByRole('checkbox', { name: 'Charges comprises' })).toBeChecked();
    expect(query()).toBe('sort=recent');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(query()).toBe('sort=recent');
  });

  it('restaure une autre URL et annule une modification en attente', async () => {
    const { rerender } = render(<SearchFilters districts={districts} />);
    fireEvent.change(surface(), { target: { value: '75' } });
    setSearchParams('propertyType=HOUSE&minSurface=30&includeCharges=false');
    rerender(<SearchFilters districts={districts} />);
    expect(surface()).toHaveValue('30');
    expect(screen.getByRole('button', { name: 'Maison' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: 'Charges comprises' })).not.toBeChecked();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('conserve le dernier choix quand une réponse précédente arrive', () => {
    const { rerender } = render(<SearchFilters districts={districts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Maison' }));
    const first = query();
    fireEvent.click(screen.getByRole('button', { name: '2 pièces' }));
    setSearchParams(first);
    rerender(<SearchFilters districts={districts} />);
    expect(screen.getByRole('button', { name: '2 pièces' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('un plafond explicite de 1 400 € reste un filtre', () => {
    setSearchParams('maxRent=1400');
    render(<SearchFilters districts={districts} />);
    expect(screen.getByLabelText(/loyer maximum/i)).toHaveAttribute('aria-valuetext', '1 400 €');
    fireEvent.click(screen.getByRole('button', { name: 'Sans plafond' }));
    expect(query()).toBe('');
  });
});

/**
 * Panneau de filtres, curseur de surface.
 *
 * Le curseur a remplacé trois paliers figés (25 / 45 / 65 m²). Le test tient
 * ce que ce remplacement a introduit : une valeur intermédiaire doit atteindre
 * l'URL, le minimum doit *retirer* le critère au lieu d'écrire « 0 », et l'URL
 * reste la seule source de vérité — c'est elle qui rend la recherche
 * partageable et rechargeable.
 */
describe('SearchFilters — surface minimum', () => {
  it('écrit dans l’URL une valeur que les paliers n’offraient pas', async () => {
    render(<SearchFilters districts={districts} />);

    fireEvent.change(surface(), { target: { value: '50' } });

    // Affiché tout de suite, écrit dans l'URL après la temporisation : sans
    // elle, chaque pixel parcouru relancerait une requête. L'assertion porte
    // sur `aria-valuetext` : c'est le libellé rendu, et c'est aussi ce qu'un
    // lecteur d'écran annonce — « 50 » seul ne dirait pas de quoi il s'agit.
    expect(surface()).toHaveAttribute('aria-valuetext', '50 m² et plus');
    await waitFor(() => expect(query()).toBe('minSurface=50'));
  });

  it('retire le critère au minimum plutôt que d’écrire zéro', async () => {
    // « minSurface=0 » ne filtre rien mais salit l'URL partagée et laisse
    // croire à un critère actif.
    setSearchParams('minSurface=50');
    render(<SearchFilters districts={districts} />);

    fireEvent.change(surface(), { target: { value: String(SURFACE_DEFAULT) } });

    expect(surface()).toHaveAttribute('aria-valuetext', 'Toutes');
    await waitFor(() => expect(query()).toBe(''));
  });

  it('part de la valeur portée par l’URL', async () => {
    // Un lien partagé ou un rechargement doit retrouver le curseur là où il
    // était : l'état vit dans l'URL, pas dans le composant.
    setSearchParams('minSurface=65');
    render(<SearchFilters districts={districts} />);

    expect(surface()).toHaveValue('65');
    expect(surface()).toHaveAttribute('aria-valuetext', '65 m² et plus');
  });

  it('garde les autres critères en bougeant la surface', async () => {
    setSearchParams('districts=sablon&furnished=furnished');
    render(<SearchFilters districts={districts} />);

    fireEvent.change(surface(), { target: { value: '30' } });

    await waitFor(() =>
      expect(query()).toBe('districts=sablon&furnished=furnished&minSurface=30'),
    );
  });

  it('ne déborde pas des bornes annoncées', () => {
    render(<SearchFilters districts={districts} />);

    expect(surface()).toHaveAttribute('min', String(SURFACE_DEFAULT));
    expect(surface()).toHaveAttribute('max', String(SURFACE_MAX));
    // Le pas de 5 m² évite de faire viser au mètre près une valeur que
    // personne ne cherche à cette précision.
    expect(surface()).toHaveAttribute('step', '5');
  });

  it('revient à « Toutes » sur réinitialisation', async () => {
    setSearchParams('minSurface=80');
    render(<SearchFilters districts={districts} />);

    await userEvent.click(screen.getByRole('button', { name: /réinitialiser/i }));

    expect(surface()).toHaveAttribute('aria-valuetext', 'Toutes');
    expect(routerMock.replace).toHaveBeenCalledWith('/', { scroll: false });
  });
});
