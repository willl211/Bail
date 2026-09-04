/**
 * Ce que l'état du compte lui-même empêche de faire.
 *
 * Distinct de `propertyChecks` : là il s'agit du bien, ici de la personne. Un
 * même compte non confirmé bloque aussi bien une candidature qu'une mise en
 * ligne, et le motif ne change pas selon le profil — d'où une fonction unique,
 * partagée, plutôt que deux messages qui finiraient par diverger.
 *
 * Pourquoi bloquer : l'adresse est le seul canal par lequel Bail prévient
 * quelqu'un. Un dossier locataire ou une annonce accrochés à une adresse jamais
 * confirmée ne valent rien — le candidat ne saurait pas qu'il est retenu, le
 * propriétaire pas qu'il a reçu une candidature. Et une adresse non confirmée
 * peut être celle de quelqu'un d'autre, saisie par erreur ou à dessein.
 *
 * Ce que ça ne bloque pas, délibérément : se connecter, remplir son dossier,
 * déposer ses pièces, préparer une annonce. On ne coupe pas l'accès à quelqu'un
 * dont le fournisseur de messagerie met dix minutes à distribuer ; on l'arrête
 * au moment où l'action engage un tiers.
 */
export interface AccountHolder {
  emailVerifiedAt: Date | null;
}

export function accountBlockers(account: AccountHolder): string[] {
  if (account.emailVerifiedAt) return [];
  return [
    'Confirmez votre adresse e-mail : le lien vous a été envoyé à l’inscription, et vous pouvez en redemander un depuis votre espace.',
  ];
}
