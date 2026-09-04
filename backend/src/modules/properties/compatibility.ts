import type { EmploymentContractType, GuarantorRequirement } from '@prisma/client';

/**
 * « Ce logement est-il à ma portée ? »
 *
 * Une seule règle, pour deux usages qui doivent dire la même chose : la note
 * figée sur une candidature au moment de son envoi, et le classement des
 * annonces pour un locataire connecté. Deux barèmes distincts finiraient par
 * diverger, et le produit promettrait à l'écran (« les biens compatibles avec
 * vos revenus remontent en tête ») autre chose que ce qu'il calcule.
 *
 * Le barème vient du parcours de candidature, où il tourne déjà. Il n'est pas
 * retouché ici : les notes déjà enregistrées sur les candidatures existantes
 * cesseraient d'être comparables à celles qui suivent.
 *
 * Fonction pure : ni Nest, ni Prisma, seulement des types. Elle se teste sur
 * des valeurs, sans base de données.
 */

export interface CompatibilityProperty {
  rentCents: number;
  chargesCents: number;
  /**
   * Vide = le propriétaire n'a rien exclu. Colonne `String[]` en base, pas une
   * énumération : le type suit ce que la base contient réellement.
   */
  acceptedContractTypes: string[];
  guarantorRequirement: GuarantorRequirement;
}

export interface CompatibilityFile {
  netMonthlyIncomeCents: number | null;
  /** Dossier vérifié par Bail, ou seulement transmis. */
  verified: boolean;
  submitted: boolean;
  contractType: EmploymentContractType | null;
  hasGuarantor: boolean;
  guarantorVerified: boolean;
}

/** Effort à partir duquel la part « budget » de la note tombe à zéro. */
const EFFORT_MAX = 0.5;

/**
 * Note de 0 à 100.
 *
 * Quatre parts, du plus au moins déterminant : le budget (40), l'état du
 * dossier (30), le type de contrat (20), le garant (10). Le budget pèse le
 * plus parce que c'est le seul critère qu'aucune pièce ne rattrape.
 */
export function compatibilityScore(
  property: CompatibilityProperty,
  file: CompatibilityFile,
): number {
  let score = 0;
  const totalRentCents = property.rentCents + property.chargesCents;

  if (file.netMonthlyIncomeCents) {
    const ratio = totalRentCents / file.netMonthlyIncomeCents;
    // Effort nul → 40 points ; effort de 50 % ou plus → 0.
    score += Math.max(0, Math.round(40 * (1 - ratio / EFFORT_MAX)));
  }

  if (file.verified) score += 30;
  else if (file.submitted) score += 15;

  const acceptedContract =
    property.acceptedContractTypes.length === 0 ||
    (file.contractType !== null && property.acceptedContractTypes.includes(file.contractType));
  if (acceptedContract) score += 20;

  if (property.guarantorRequirement === 'NONE') score += 10;
  else if (file.hasGuarantor && file.guarantorVerified) score += 10;
  else if (file.hasGuarantor) score += 5;

  return Math.min(100, Math.max(0, score));
}

/**
 * La note peut-elle départager deux annonces ?
 *
 * L'état du dossier et le garant valent autant partout : sans revenus connus,
 * il ne reste que le type de contrat, qui range les annonces en deux paquets
 * et laisse la moitié du portefeuille ex æquo. Un classement qui ne classe pas
 * vaut moins que la récence, qui au moins met en avant ce qui vient d'arriver.
 */
export function canRankByCompatibility(file: CompatibilityFile | null): file is CompatibilityFile {
  return file !== null && file.netMonthlyIncomeCents !== null && file.netMonthlyIncomeCents > 0;
}
