import { EnergyRating, Prisma, PropertyDocumentType } from '@prisma/client';

/** Location principale en métropole, circuit standard avec DPE. Sources : docs/property-publication.md. */
export const DIAGNOSTIC_QUESTIONS = {
  electricalDiagnostic: { type: 'ELECTRICAL', label: 'Installation électrique de plus de 15 ans' },
  gasDiagnostic: { type: 'GAS', label: 'Installation de gaz de plus de 15 ans' },
  riskDiagnostic: { type: 'ERP', label: 'Logement situé dans une zone à risques' },
  noiseDiagnostic: { type: 'NOISE', label: 'Zone de bruit des aéroports' },
} as const;

export interface DiagnosticFacts {
  constructionYear?: number | null;
  electricalDiagnostic?: string;
  gasDiagnostic?: string;
  riskDiagnostic?: string;
  noiseDiagnostic?: string;
}

export const DIAGNOSTIC_LABELS: Record<PropertyDocumentType, string> = {
  DPE: 'DPE', LEAD: 'Plomb (CREP)', ELECTRICAL: 'Électricité', GAS: 'Gaz',
  ERP: 'État des risques', NOISE: 'Bruit des aéroports', ASBESTOS: 'Amiante', OTHER: 'Autre document',
};

export function requiredDiagnostics(property: DiagnosticFacts): PropertyDocumentType[] {
  const types: PropertyDocumentType[] = ['DPE'];
  if (property.constructionYear && property.constructionYear < 1949) types.push('LEAD');
  for (const [key, rule] of Object.entries(DIAGNOSTIC_QUESTIONS)) {
    if (property[key as keyof typeof DIAGNOSTIC_QUESTIONS] === 'REQUIRED') types.push(rule.type);
  }
  return types;
}

export function diagnosticFactBlockers(property: DiagnosticFacts): string[] {
  const blockers: string[] = [];
  if (!property.constructionYear) blockers.push('Année de construction à renseigner pour déterminer les diagnostics');
  for (const [key, rule] of Object.entries(DIAGNOSTIC_QUESTIONS)) {
    if (!['REQUIRED', 'NOT_REQUIRED'].includes(property[key as keyof typeof DIAGNOSTIC_QUESTIONS] ?? ''))
      blockers.push(`${rule.label} : situation à renseigner`);
  }
  return blockers;
}

// Europe/Paris : les échéances légales ne basculent pas une heure trop tard en janvier.
export function allowedEnergyRatings(now = new Date()): EnergyRating[] {
  return (now >= new Date('2033-12-31T23:00:00Z') ? ['A', 'B', 'C', 'D']
    : now >= new Date('2027-12-31T23:00:00Z') ? ['A', 'B', 'C', 'D', 'E']
      : ['A', 'B', 'C', 'D', 'E', 'F']) as EnergyRating[];
}

export function energyBlockers(rating: string | null, now = new Date()): string[] {
  if (!rating) return ['Classe DPE manquante'];
  return allowedEnergyRatings(now).includes(rating as EnergyRating) ? []
    : [`Classe DPE ${rating} : ce logement ne peut pas être proposé à la location en métropole à cette date`];
}

/** Décalage calendaire avec dernier jour du mois borné (31 août + 6 mois). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const end = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, end));
  return result;
}

export function diagnosticMonths(type: PropertyDocumentType, leadNoRisk = false): number | null {
  return type === 'DPE' ? 120 : type === 'ERP' ? 6
    : ['ELECTRICAL', 'GAS'].includes(type) || (type === 'LEAD' && !leadNoRisk) ? 72 : null;
}

/** Les dates de réalisation sont saisies au jour, normalisées à minuit UTC. */
function earliestCurrentIssue(now: Date, months: number): Date {
  const candidate = addMonths(now, -months);
  candidate.setUTCHours(0, 0, 0, 0);
  // Une soustraction naïve est incorrecte le 28 février pour un ERP du 31 août.
  while (addMonths(candidate, months) <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

export function diagnosticDateError(type: PropertyDocumentType, issuedAt: Date | null, expiresAt: Date | null,
  leadNoRisk: boolean, now = new Date()): string | null {
  if (!issuedAt || issuedAt > now) return 'Renseignez une date de réalisation passée ou du jour.';
  if (type === 'DPE' && issuedAt < new Date('2021-07-01T00:00:00Z'))
    return 'Les DPE réalisés avant juillet 2021 ne sont plus valables.';
  if (leadNoRisk && type !== 'LEAD') return 'La validité illimitée pour absence de plomb concerne uniquement le CREP.';
  const months = diagnosticMonths(type, leadNoRisk);
  if (months && !expiresAt) return 'La date de fin de validité est requise pour ce diagnostic.';
  if (expiresAt && (expiresAt <= now || expiresAt < issuedAt)) return 'Le diagnostic est expiré ou ses dates sont incohérentes.';
  if (months && expiresAt && expiresAt >= addMonths(issuedAt, months))
    return `La validité ne peut pas dépasser ${months === 6 ? '6 mois' : `${months / 12} ans`} après la réalisation. Saisissez le dernier jour de validité.`;
  return null;
}

/** Même exigence pour les accès directs et les listes ; aucune fenêtre d'exposition entre deux tâches. */
export function diagnosticVisibilityWhere(now = new Date()): Prisma.PropertyWhereInput {
  const current = (type: PropertyDocumentType): Prisma.PropertyWhereInput => ({ documents: { some: {
    type, status: 'VERIFIED', issuedAt: { lte: now, ...(type === 'DPE' ? { gte: new Date('2021-07-01') } : {}) },
    AND: diagnosticMonths(type) ? [{ OR: [
      { issuedAt: { gte: earliestCurrentIssue(now, diagnosticMonths(type)!) } },
      ...(type === 'LEAD' ? [{ leadNoRisk: true }] : []),
    ] }] : [],
    OR: [{ expiresAt: { gt: now } }, ...(['NOISE', 'LEAD'].includes(type)
      ? [{ expiresAt: null, ...(type === 'LEAD' ? { leadNoRisk: true } : {}) }] : [])],
  } } });
  return {
    energyRating: { in: allowedEnergyRatings(now) }, constructionYear: { not: null },
    AND: [current('DPE'), { OR: [{ constructionYear: { gte: 1949 } }, current('LEAD')] },
      ...Object.entries(DIAGNOSTIC_QUESTIONS).map(([key, rule]) => ({ OR: [
        { [key]: 'NOT_REQUIRED' }, { AND: [{ [key]: 'REQUIRED' }, current(rule.type)] },
      ] })),
    ],
  };
}
