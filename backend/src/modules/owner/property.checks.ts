import type { DocumentStatus, PropertyDocumentType } from '@prisma/client';
import { addMonths, diagnosticMonths, diagnosticFactBlockers, energyBlockers, requiredDiagnostics, DIAGNOSTIC_LABELS, type DiagnosticFacts } from './diagnostic-policy';

export interface ReviewableDiagnostic {
  type: PropertyDocumentType;
  status: DocumentStatus;
  expiresAt: Date | null;
  issuedAt?: Date | null;
  leadNoRisk?: boolean;
}

export function isCurrentDiagnostic(document: ReviewableDiagnostic, now = new Date()): boolean {
  const months = diagnosticMonths(document.type, document.leadNoRisk);
  return (
    document.status === 'VERIFIED' &&
    (!months || (document.issuedAt != null && addMonths(document.issuedAt, months) > now)) &&
    (['ASBESTOS', 'OTHER'].includes(document.type) || (document.issuedAt != null && document.issuedAt <= now)) &&
    (document.type !== 'DPE' || (document.issuedAt != null && document.issuedAt >= new Date('2021-07-01') && document.issuedAt <= now)) &&
    (document.expiresAt !== null
      ? document.expiresAt.getTime() > now.getTime()
      : ['ASBESTOS', 'NOISE', 'OTHER'].includes(document.type) || (document.type === 'LEAD' && document.leadNoRisk === true))
  );
}

export function diagnosticStatus(document: ReviewableDiagnostic, now = new Date()): DocumentStatus {
  if (document.status !== 'VERIFIED') return document.status;
  const months = diagnosticMonths(document.type, document.leadNoRisk);
  const expired = (document.expiresAt && document.expiresAt <= now)
    || (months && document.issuedAt && addMonths(document.issuedAt, months) <= now)
    || (document.type === 'DPE' && document.issuedAt && document.issuedAt < new Date('2021-07-01'));
  if (expired) return 'EXPIRED';
  return isCurrentDiagnostic(document, now) ? 'VERIFIED' : 'PENDING';
}

/** Le propriétaire peut soumettre un DPE en attente ; seul l'agent peut le publier. */
export function publicationChecks(
  property: Omit<CheckableProperty, 'documents'> & { documents: ReviewableDiagnostic[] },
  now = new Date(),
): PropertyChecks {
  const checks = propertyChecks(property, now);
  for (const type of requiredDiagnostics(property)) {
    const docs = property.documents.filter((document) => document.type === type);
    if (docs.length > 0 && !docs.some((document) => isCurrentDiagnostic(document, now))) {
      checks.blockers.push(`${DIAGNOSTIC_LABELS[type]} à valider : un diagnostic vérifié et en cours de validité est requis`);
    }
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

export interface CheckableProperty extends DiagnosticFacts {
  energyRating: string | null;
  photos: unknown[];
  documents?: { type: PropertyDocumentType }[];
  description: string;
  title: string;
  addressLine: string;
  surfaceM2: number;
  rentCents: number;
}

export function propertyChecks(property: CheckableProperty, now = new Date()): PropertyChecks {
  const blockers = [...energyBlockers(property.energyRating, now), ...diagnosticFactBlockers(property)];
  const warnings: string[] = [];

  // Deux exigences distinctes : le **fichier** du DPE, obligatoire pour
  // diffuser une annonce, et la **classe** affichée sur la fiche. Fournir
  // l'une sans l'autre ne suffit pas.
  for (const type of requiredDiagnostics(property)) {
    if (property.documents && !property.documents.some((d) => d.type === type)) blockers.push(`${DIAGNOSTIC_LABELS[type]} manquant`);
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
