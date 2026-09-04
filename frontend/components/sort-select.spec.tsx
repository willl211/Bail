import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortSelect } from './sort-select';
import { routerMock, setSearchParams } from '../test/setup-components';

const select = () => screen.getByRole('combobox', { name: /trier les résultats/i });
const options = () =>
  screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);

/** Dernière adresse écrite, sans le chemin. */
const query = () => {
  const calls = routerMock.replace.mock.calls;
  const url = (calls[calls.length - 1]?.[0] as string) ?? '';
  return url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
};

/**
 * Sélecteur de tri.
 *
 * Ce qu'il porte de délicat n'est pas la liste, c'est le défaut : l'API trie
 * par compatibilité quand rien n'est demandé, mais retombe sur la récence pour
 * qui n'a pas de dossier. Le sélecteur doit donc afficher ce qu'une URL vide
 * produit **pour cette personne-là**, faute de quoi il annoncerait un tri qui
 * n'a pas lieu.
 */
describe('SortSelect', () => {
  it('n’offre pas la compatibilité à qui n’a pas de dossier', async () => {
    // L'annoncer à un visiteur anonyme promettrait un classement qui
    // retomberait sur la récence.
    render(<SortSelect compatibility={false} />);

    expect(options()).not.toContain('compatibility');
    expect(select()).toHaveValue('recent');
  });

  it('l’offre au locataire, et l’affiche comme défaut', async () => {
    render(<SortSelect compatibility />);

    expect(options()[0]).toBe('compatibility');
    // URL vide : c'est bien ce que l'API sert par défaut à un locataire.
    expect(select()).toHaveValue('compatibility');
  });

  it('n’écrit rien dans l’URL en revenant au défaut', async () => {
    // « ?sort=compatibility » serait un paramètre qui ne change rien, traîné
    // dans chaque lien partagé.
    setSearchParams('sort=rent_asc');
    render(<SortSelect compatibility />);

    await userEvent.selectOptions(select(), 'compatibility');

    expect(query()).toBe('');
  });

  it('écrit le tri choisi et garde les filtres', async () => {
    setSearchParams('districts=sablon&minSurface=40');
    render(<SortSelect compatibility={false} />);

    await userEvent.selectOptions(select(), 'rent_desc');

    expect(query()).toBe('districts=sablon&minSurface=40&sort=rent_desc');
  });

  it('part de la valeur portée par l’URL', () => {
    setSearchParams('sort=surface_desc');
    render(<SortSelect compatibility />);

    expect(select()).toHaveValue('surface_desc');
  });
});
