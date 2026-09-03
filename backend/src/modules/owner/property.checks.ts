import type { PropertyDocumentType } from '@prisma/client';

/**
 * Ce qui empêche de publier une annonce, et ce qui la dessert seulement.
 *
 * Fonction pure et partagée, volontairement : le propriétaire la voit avant de
 * soumettre, l'API l'applique à la soumission, et le back-office l'applique
 * encore avant de mettre en ligne. Trois endroits, une seule règle — la
 * dupliquer serait le plus sûr moyen de publier un jour un bien sans DPE.
 */
export interface PropertyChecks {
  blockers: string[];
  warnings: string[];
}

export interface CheckableProperty {
  energyRating: string | null;
  photos: unknown[];
  documents?: { type: PropertyDocumentType }[];
  description: string;
  title: string;
  addressLine: string;
  surfaceM2: number;
  rentCents: number;
}

export function propertyChecks(property: CheckableProperty): PropertyChecks {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Deux exigences distinctes : le **fichier** du DPE, obligatoire pour
  // diffuser une annonce, et la **classe** affichée sur la fiche. Fournir
  // l'une sans l'autre ne suffit pas.
  if (!property.energyRating) blockers.push('Classe DPE manquante');
  if (property.documents && !property.documents.some((d) => d.type === 'DPE')) {
    blockers.push('DPE manquant');
  }
  if (!property.addressLine.trim()) blockers.push('Adresse manquante');
  if (!property.title.trim() || property.title === 'Nouveau bien') {
    blockers.push('Titre de l’annonce manquant');
  }
  if (property.surfaceM2 <= 0) blockers.push('Surface manquante');
  if (property.rentCents <= 0) blockers.push('Loyer manquant');

  // Le nombre de photos est une recommandation : refuser la publication d'un
  // bien complet parce qu'il n'en a que cinq serait absurde.
  if (property.photos.length < 6) {
    warnings.push(`Photos (${property.photos.length} / 6)`);
  }
  if (property.description.trim().length < 80) {
    warnings.push('Description courte');
  }

  return { blockers, warnings };
}
