import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroSearch } from './hero-search';
import { routerMock } from '../test/setup-components';

const districts = [
  { slug: 'centre-ville', name: 'Centre-ville', city: 'Metz', availableCount: 3 },
  { slug: 'nouvelle-ville', name: 'Nouvelle Ville', city: 'Metz', availableCount: 2 },
  { slug: 'outre-seille', name: 'Outre-Seille', city: 'Metz', availableCount: 1 },
];

const cible = () => (routerMock.push.mock.calls[0]?.[0] as string) ?? null;

/**
 * Barre de recherche de l'accueil.
 *
 * Les trois champs se saisissent librement depuis qu'ils ont remplacé des
 * listes fermées. Ce qui mérite d'être tenu par un test, c'est justement ce que
 * la saisie libre a rendu possible : une valeur hors des anciens paliers doit
 * passer, un quartier inventé doit être refusé plutôt que silencieusement
 * ignoré, et un champ vide ne doit filtrer sur rien.
 */
describe('HeroSearch', () => {
  const remplir = async (champ: RegExp, valeur: string) => {
    const input = screen.getByLabelText(champ);
    await userEvent.clear(input);
    if (valeur) await userEvent.type(input, valeur);
  };

  it('transmet des valeurs hors des anciens paliers', async () => {
    // Les listes déroulantes n'offraient que 800 ou 1 000 € : personne ne
    // cherche à ces montants-là, c'est toute la raison du changement.
    render(<HeroSearch districts={districts} />);

    await remplir(/quartier/i, 'Nouvelle Ville');
    await remplir(/loyer max/i, '950');
    await remplir(/pièces min/i, '2');
    await userEvent.click(screen.getByRole('button', { name: /rechercher/i }));

    expect(cible()).toBe('/recherche?districts=nouvelle-ville&maxRent=950&minRooms=2');
  });

  it('reconnaît un quartier sans accent ni majuscule', async () => {
    // « outre-seille » tapé à la volée doit valoir « Outre-Seille » : exiger la
    // graphie exacte punirait une saisie parfaitement claire.
    render(<HeroSearch districts={districts} />);

    await remplir(/quartier/i, 'outre-seille');
    await remplir(/loyer max/i, '');
    await userEvent.click(screen.getByRole('button', { name: /rechercher/i }));

    expect(cible()).toBe('/recherche?districts=outre-seille');
  });

  it('refuse un quartier inconnu en disant pourquoi', async () => {
    // Le filtre porte sur un référentiel fermé côté API : chercher quand même
    // ferait croire au filtre et renverrait tout le portefeuille.
    render(<HeroSearch districts={districts} />);

    await remplir(/quartier/i, 'Montmartre');
    await userEvent.click(screen.getByRole('button', { name: /rechercher/i }));

    expect(routerMock.push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Montmartre');
  });

  it('efface le refus dès que la saisie reprend', async () => {
    render(<HeroSearch districts={districts} />);

    await remplir(/quartier/i, 'Montmartre');
    await userEvent.click(screen.getByRole('button', { name: /rechercher/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/quartier/i), '{backspace}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ne filtre sur rien quand tout est vide', async () => {
    // Quelqu'un qui efface le loyer proposé par défaut demande à voir tout le
    // portefeuille, pas à conserver un plafond invisible.
    render(<HeroSearch districts={districts} />);

    await remplir(/loyer max/i, '');
    await userEvent.click(screen.getByRole('button', { name: /rechercher/i }));

    expect(cible()).toBe('/recherche');
  });

  it('ignore un loyer nul ou négatif', async () => {
    // `type=number` n'empêche ni le zéro ni le collage d'une valeur absurde ;
    // les transmettre masquerait toutes les annonces sans rien expliquer.
    render(<HeroSearch districts={districts} />);

    await remplir(/loyer max/i, '0');
    await userEvent.click(screen.getByRole('button', { name: /rechercher/i }));

    expect(cible()).toBe('/recherche');
  });
});
