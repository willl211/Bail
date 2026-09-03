import { VisitType } from '@prisma/client';

/**
 * Durée d'un rendez-vous selon son type, en minutes.
 *
 * Reprises de la maquette : 30 minutes sur place, 20 en visio. Ce ne sont pas
 * des montants — rien n'oblige à les sortir en base — mais elles conditionnent
 * le chevauchement des créneaux, d'où leur présence ici plutôt qu'éparpillées
 * dans les écrans.
 */
export const VISIT_DURATION_MINUTES: Record<VisitType, number> = {
  [VisitType.ACCOMPANIED]: 30,
  [VisitType.VIDEO]: 20,
};

/** Réglages de visite lus en base, avec leurs valeurs de repli. */
export interface VisitPolicy {
  /**
   * Empreinte bancaire prise avant le rendez-vous, en centimes.
   *
   * 1 € dans la maquette : c'est une vérification de moyen de paiement, pas
   * une caution. Le montant vit en base parce qu'il est susceptible de bouger
   * (README, règle 3) — et il n'a rien à faire dans `fee_schedules`, qui porte
   * les honoraires.
   */
  preauthorizationAmountCents: number;
  /** Délai minimal d'annulation, en heures. */
  cancellationDeadlineHours: number;
  /** Rétention de l'enregistrement vidéo, en jours. */
  recordingRetentionDays: number;
}

export const DEFAULT_VISIT_POLICY: VisitPolicy = {
  preauthorizationAmountCents: 100,
  cancellationDeadlineHours: 4,
  recordingRetentionDays: 15,
};

export const VISIT_SETTING_KEYS = {
  preauthorizationAmountCents: 'visits.preauthorizationAmountCents',
  cancellationDeadlineHours: 'visits.cancellationDeadlineHours',
  recordingRetentionDays: 'visits.recordingRetentionDays',
} as const;

/**
 * Deux créneaux se chevauchent-ils ?
 *
 * Comparé sur les durées réellement réservées, pas sur les seuls horaires de
 * début : ouvrir 17:00 et 17:15 pour une visite de 30 minutes reviendrait à
 * promettre à l'agent d'être à deux endroits à la fois.
 */
export function overlaps(
  a: { startsAt: Date; durationMinutes: number },
  b: { startsAt: Date; durationMinutes: number },
): boolean {
  const endA = a.startsAt.getTime() + a.durationMinutes * 60_000;
  const endB = b.startsAt.getTime() + b.durationMinutes * 60_000;
  return a.startsAt.getTime() < endB && b.startsAt.getTime() < endA;
}
