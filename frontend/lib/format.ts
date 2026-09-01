/**
 * Formats d'affichage.
 *
 * La maquette affiche toutes les données chiffrées en IBM Plex Mono et en
 * capitales (« 47 M² », « 2 PIÈCES », « MEUBLÉ ») : ces fonctions produisent
 * exactement ces chaînes, pour qu'aucun composant n'ait à improviser.
 */

/** 69000 -> « 690 € ». Les montants circulent en centimes côté API. */
export function euros(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString('fr-FR')} €`;
}

/** 47 -> « 47 M² » (capitale, contexte mono). */
export function surface(m2: number): string {
  const value = Number.isInteger(m2) ? m2 : Number(m2.toFixed(1));
  return `${value.toLocaleString('fr-FR')} M²`;
}

/** 47 -> « 47 m² » (bas de casse, contexte rédactionnel). */
export function surfaceLower(m2: number): string {
  const value = Number.isInteger(m2) ? m2 : Number(m2.toFixed(1));
  return `${value.toLocaleString('fr-FR')} m²`;
}

export function rooms(count: number): string {
  return `${count} ${count > 1 ? 'PIÈCES' : 'PIÈCE'}`;
}

export function furnished(isFurnished: boolean): string {
  return isFurnished ? 'MEUBLÉ' : 'NU';
}

export function furnishedLabel(isFurnished: boolean): string {
  return isFurnished ? 'Meublé' : 'Nu';
}

/** Disponibilité au format court de la maquette : « 01.10.26 » ou « immédiat ». */
export function availability(
  availableFrom: string | null,
  availableImmediately: boolean,
): string {
  if (availableImmediately || !availableFrom) return 'immédiat';
  const date = new Date(availableFrom);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

/** Durée légale du bail, formulée comme sur la fiche : « 3 ans », « 1 an ». */
export function leaseDuration(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years > 1 ? 'ans' : 'an'}`;
  }
  return `${months} mois`;
}

const GUARANTOR_LABELS: Record<string, string> = {
  NONE: 'Non demandé',
  OPTIONAL: 'Facultatif',
  REQUIRED: 'Exigé',
};

export function guarantorRequirement(value: string): string {
  return GUARANTOR_LABELS[value] ?? value;
}

const CONTRACT_LABELS: Record<string, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  PUBLIC_SECTOR: 'fonction publique',
  SELF_EMPLOYED: 'indépendant',
  STUDENT: 'étudiant',
  RETIRED: 'retraité',
  OTHER: 'autre',
};

export function contractTypes(values: string[]): string {
  if (values.length === 0) return 'Tous';
  const labels = values.map((value) => CONTRACT_LABELS[value] ?? value);
  if (labels.length === 1) return labels[0];
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(', ')} ou ${last}`;
}
