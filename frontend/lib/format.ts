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

/**
 * Classe DPE, ou tiret cadratin si elle manque.
 *
 * Une annonce publiée en porte toujours une — le DPE est obligatoire pour
 * diffuser — mais le champ est nullable pour permettre les brouillons. Afficher
 * « DPE » suivi d'un vide serait pire qu'un tiret assumé.
 */
export function energyRating(value: string | null): string {
  return value ?? '—';
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

/**
 * 3900 -> « 39,00 € ». Format des lignes de facturation, où les centimes
 * comptent — contrairement aux loyers, arrondis à l'euro par `euros()`.
 */
export function eurosPrecise(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/**
 * Fuseau du produit.
 *
 * Le pilote est messin : un créneau de visite s'annonce en heure française,
 * quelle que soit la machine qui rend la page. Épingler le fuseau plutôt que
 * s'en remettre à celui du serveur n'est pas une précaution de principe — le
 * rendu Next tourne en UTC en production, et un rendez-vous de 16 h s'y
 * afficherait à 14 h, alors que l'e-mail de confirmation, lui, dit déjà
 * l'heure de Paris (`event.templates.ts`). Deux heures pour le même
 * rendez-vous, c'est quelqu'un qui arrive quand l'agent est reparti.
 */
const TZ = 'Europe/Paris';

/** Champs d'un instant, lus dans le fuseau du produit. */
function parts(iso: string): Record<string, string> {
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // `h23` plutôt que `hour12: false` : ce dernier rend minuit « 24 » dans
    // certaines implémentations.
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

/** Portion de date en toutes lettres, dans le fuseau du produit. */
function words(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('fr-FR', { ...options, timeZone: TZ });
}

/** Date longue : « 1er octobre 2026 ». */
export function longDate(iso: string): string {
  const day = Number(parts(iso).day);
  return `${day === 1 ? '1er' : day} ${words(iso, { month: 'long', year: 'numeric' })}`;
}

/** Horodatage court du journal : « 02.09 · 09:14 ». */
export function logStamp(iso: string): string {
  const { day, month, hour, minute } = parts(iso);
  return `${day}.${month} · ${hour}:${minute}`;
}

/**
 * Ancienneté d'une candidature : « 3 h », « hier », « 4 jours », « 12.08 ».
 *
 * Forme télégraphique, comme le reste des colonnes chiffrées de la maquette
 * (« 47 M² », « 31 h ») : l'en-tête de colonne porte déjà le sens, et une
 * tournure complète (« il y a 4 jours ») élargirait la table au point de la
 * faire défiler sur un écran courant.
 */
export function relativeAge(iso: string, now = new Date()): string {
  const hours = Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'à l’instant';
  if (hours < 24) return `${hours} h`;
  if (hours < 48) return 'hier';
  const days = Math.floor(hours / 24);
  if (days < 8) return `${days} jours`;
  const { day, month } = parts(iso);
  return `${day}.${month}`;
}

/** Taux d'effort : 0.324 -> « 32 % ». */
export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

/** En-tête de colonne du calendrier de visites : « LUN 08.09 ». */
export function dayHeading(iso: string): string {
  const weekday = words(iso, { weekday: 'short' }).replace('.', '');
  const { day, month } = parts(iso);
  return `${weekday} ${day}.${month}`;
}

/** Heure seule d'un créneau : « 18:30 ». */
export function timeOfDay(iso: string): string {
  const { hour, minute } = parts(iso);
  return `${hour}:${minute}`;
}

/** Rendez-vous en toutes lettres : « mercredi 10 septembre · 18:30 ». */
export function appointment(iso: string): string {
  return `${words(iso, { weekday: 'long', day: 'numeric', month: 'long' })} · ${timeOfDay(iso)}`;
}
