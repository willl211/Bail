/**
 * Complétude de l'adresse postale du bailleur.
 *
 * Module à part, comme `property.checks.ts` et `account.checks.ts` : ces règles
 * ne dépendent de rien — ni de Nest, ni de Prisma — et c'est ce qui permet de
 * les tester sans démarrer quoi que ce soit. Les enfouir dans un service les
 * rendrait solidaires de tout le graphe de modules.
 *
 * Pourquoi « tout ou rien » plutôt qu'un décompte de champs : la loi n° 89-462
 * du 6 juillet 1989 (article 3) exige que le bail désigne le **domicile** du
 * bailleur. Une voie sans commune, ou une commune sans code postal, ne désigne
 * aucun domicile — et le locataire n'aurait plus d'adresse où notifier un
 * congé, une réclamation ou une mise en demeure.
 */
export interface PostalAddress {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
}

export function isAddressComplete(address: PostalAddress): boolean {
  return Boolean(
    address.addressLine?.trim() && address.postalCode?.trim() && address.city?.trim(),
  );
}

/** Adresse sur une ligne, telle qu'elle figure au bail. Vide si incomplète. */
export function formatAddress(address: PostalAddress): string {
  if (!isAddressComplete(address)) return '';
  return `${address.addressLine}, ${address.postalCode} ${address.city}`;
}
