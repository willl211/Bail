/**
 * Validité d'une demande de signature, en jours.
 *
 * Deux endroits en dépendent et ne peuvent pas diverger : le service, qui la
 * transmet au prestataire, et le message qui l'annonce aux signataires. Un
 * délai annoncé plus long que celui qui s'applique ferait revenir quelqu'un
 * sur un lien déjà expiré.
 */
export const SIGNATURE_VALIDITY_DAYS = 7;
