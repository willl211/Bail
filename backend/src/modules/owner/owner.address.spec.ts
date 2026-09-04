import { formatAddress, isAddressComplete } from './address.checks';

/**
 * Complétude de l'adresse du bailleur.
 *
 * Elle décide si un bail peut partir en signature : la loi n° 89-462 du
 * 6 juillet 1989 (article 3) exige que l'acte désigne le domicile du bailleur,
 * faute de quoi le locataire n'a plus d'adresse où lui notifier un congé, une
 * réclamation ou une mise en demeure. Une adresse amputée d'un de ses trois
 * éléments ne désigne aucun domicile — d'où une règle « tout ou rien » plutôt
 * qu'un décompte de champs remplis.
 */
const complete = { addressLine: '9 rue Serpenoise', postalCode: '57000', city: 'Metz' };

describe('isAddressComplete', () => {
  it('accepte une adresse dont les trois éléments sont présents', () => {
    expect(isAddressComplete(complete)).toBe(true);
  });

  it.each([
    ['la voie', 'addressLine'],
    ['le code postal', 'postalCode'],
    ['la commune', 'city'],
  ])('refuse une adresse sans %s', (_label, champ) => {
    expect(isAddressComplete({ ...complete, [champ]: null })).toBe(false);
  });

  it.each([
    ['la voie', 'addressLine'],
    ['le code postal', 'postalCode'],
    ['la commune', 'city'],
  ])('traite %s réduite à des espaces comme absente', (_label, champ) => {
    // Une chaîne d'espaces passe une contrainte « non nul » sans désigner quoi
    // que ce soit : elle produirait une ligne vide au milieu de l'acte.
    expect(isAddressComplete({ ...complete, [champ]: '   ' })).toBe(false);
  });

  it('refuse une adresse entièrement vide', () => {
    expect(isAddressComplete({ addressLine: null, postalCode: null, city: null })).toBe(
      false,
    );
  });
});

describe('formatAddress', () => {
  it('compose la ligne telle qu’elle figure au bail', () => {
    expect(formatAddress(complete)).toBe('9 rue Serpenoise, 57000 Metz');
  });

  it('renvoie une chaîne vide plutôt qu’une adresse tronquée', () => {
    // Un acte portant « 9 rue Serpenoise, null Metz » serait pire qu'un champ
    // laissé vide : le contrôle de complétude ne le signalerait même pas.
    expect(formatAddress({ ...complete, postalCode: null })).toBe('');
    expect(formatAddress({ addressLine: null, postalCode: null, city: null })).toBe('');
  });
});
