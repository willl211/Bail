import type { DocumentStatus, PropertyDocumentType } from '@prisma/client';

export interface ReviewableDiagnostic {
  type: PropertyDocumentType;
  status: DocumentStatus;
  expiresAt: Date | null;
}

export function isCurrentDiagnostic(document: ReviewableDiagnostic, now = new Date()): boolean {
  return (
    document.status === 'VERIFIED' &&
    (document.expiresAt !== null
      ? document.expiresAt.getTime() > now.getTime()
      : document.type !== 'DPE')
  );
}

export function diagnosticStatus(document: ReviewableDiagnostic, now = new Date()): DocumentStatus {
  return document.status === 'VERIFIED' && document.expiresAt && document.expiresAt <= now
    ? 'EXPIRED'
    : document.status;
}

/** Le propriétaire peut soumettre un DPE en attente ; seul l'agent peut le publier. */
export function publicationChecks(
  property: Omit<CheckableProperty, 'documents'> & { documents: ReviewableDiagnostic[] },
): PropertyChecks {
  const checks = propertyChecks(property);
  const dpe = property.documents.filter((document) => document.type === 'DPE');
  if (dpe.length > 0 && !dpe.some((document) => isCurrentDiagnostic(document))) {
    checks.blockers.push(
      'DPE à valider : un diagnostic vérifié et en cours de validité est requis',
    );
  }
  return checks;
}

/**
 * Prérequis partagés de l'annonce. La soumission accepte les pièces à contrôler ;
 * publicationChecks ajoute la validation et la validité du DPE avant diffusion.
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
