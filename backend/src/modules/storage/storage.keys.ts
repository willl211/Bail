/**
 * Nommage des emplacements de stockage.
 *
 * Module pur — sans Nest, sans Prisma — comme les autres règles du projet
 * (README, principe 10). Ce n'est pas une coquetterie : c'est ce qui permet de
 * couvrir par des tests le garde-fou qui empêche qu'un dossier calculé à partir
 * d'une donnée utilisateur ne devienne une traversée de répertoire, ou pire un
 * franchissement de la frontière entre public et privé.
 *
 * Renvoie `null` plutôt que de lever : une fonction pure n'a pas à décider d'un
 * code HTTP. C'est l'appelant qui traduit.
 */

/** Seuls caractères admis dans un chemin de dossier. */
const AUTORISES = /[^a-z0-9/-]/g;

export function sanitizeFolder(folder: string): string | null {
  // C'est cette liste blanche, et elle seule, qui neutralise les traversées :
  // un point n'y figure pas, donc `../..` devient `--/--`. Inutile d'ajouter un
  // retrait explicite des points — il serait inatteignable, et laisserait
  // croire que la protection vient de lui.
  const cleaned = folder
    .toLowerCase()
    .replace(AUTORISES, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');

  // Un chemin réduit à des séparateurs (« --- », « / ») est le signe que
  // l'appelant a calculé sa destination à partir de rien. Mieux vaut refuser
  // que d'écrire dans un dossier au nom absurde, impossible à relier ensuite à
  // quoi que ce soit.
  if (!/[a-z0-9]/.test(cleaned)) return null;

  return cleaned;
}
