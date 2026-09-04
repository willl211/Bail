/**
 * Attribution d'un logement : les motifs inscrits sur ce qu'elle ferme.
 *
 * Quand le propriétaire retient un candidat, toutes les autres candidatures
 * encore ouvertes sur le bien se ferment d'un coup, et les rendez-vous de
 * visite qu'elles portaient sont annulés. Trois endroits ont besoin de
 * reconnaître ce cas : le service qui l'écrit, l'écran qui l'affiche, et le
 * gabarit d'e-mail qui doit dire « le logement est parti » et non « votre
 * dossier a été refusé ».
 *
 * Les deux libellés sont donc posés ici, sans dépendance : recopiés d'un
 * fichier à l'autre, ils finiraient par diverger d'un point ou d'une majuscule,
 * et la reconnaissance du cas échouerait en silence.
 */

/** Motif porté par les candidatures que l'attribution ferme. */
export const ATTRIBUTION_REASON = 'Le logement a été attribué à un autre candidat.';

/** Motif porté par les visites que l'attribution annule. */
export const ATTRIBUTION_VISIT_REASON = 'Logement attribué à un autre candidat';
