import '@testing-library/jest-dom';

/**
 * Environnement des tests de composants.
 *
 * `next/navigation` est doublé une fois pour toutes : les composants clients
 * appellent `useRouter()` pour rafraîchir un rendu serveur, et le vrai routeur
 * n'existe pas hors d'une application Next. Le double expose les mêmes
 * fonctions, ce qui permet en prime de vérifier qu'un `refresh()` a bien lieu
 * là où il compte.
 */
/**
 * Paramètres d'URL lus par les composants de recherche.
 *
 * Mutable parce que l'état des filtres vit dans l'URL : un test qui veut
 * vérifier un filtre déjà actif doit pouvoir partir d'une URL non vide.
 * Remis à vide avant chaque test.
 */
export let searchParamsMock = new URLSearchParams();
export const setSearchParams = (query: string) => {
  searchParamsMock = new URLSearchParams(query);
};

export const routerMock = {
  refresh: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  prefetch: jest.fn(),
};

jest.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/',
  useSearchParams: () => searchParamsMock,
}));

beforeEach(() => {
  jest.clearAllMocks();
  searchParamsMock = new URLSearchParams();
});
