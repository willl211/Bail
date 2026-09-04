/**
 * Champs qu'un modèle de bail autorise à injecter.
 *
 * La **source de vérité reste la base** : chaque `LeaseTemplate` porte son
 * propre schéma, parce qu'une version du texte peut ouvrir ou fermer un champ
 * sans que les baux déjà signés changent de forme. Ce qui est ici n'est que le
 * schéma de départ, celui du squelette posé par le seed — et celui que les
 * tests reprennent, pour que le décor ne diverge pas de la réalité.
 *
 * Aucun champ hors de ce schéma n'est injecté : le service refuse, et c'est ce
 * refus qui garantit que la plateforme n'ajoute rien au texte de l'avocat
 * (CLAUDE.md règle 2).
 */
export const LEASE_FIELD_SCHEMA = {
  titreContrat: { type: 'string', required: true },
  bailleurNomComplet: { type: 'string', required: true },
  bailleurAdresse: { type: 'string', required: true },
  locataireNomComplet: { type: 'string', required: true },
  logementAdresse: { type: 'string', required: true },
  logementTypeHabitat: {
    type: 'enum',
    values: ['immeuble collectif', 'immeuble individuel'],
    required: true,
  },
  logementSurfaceM2: { type: 'number', required: true, min: 9 },
  logementNombrePieces: { type: 'integer', required: true, min: 1 },
  bailDateDebut: { type: 'date', required: true },
  bailDureeMois: { type: 'integer', required: true },
  loyerMensuel: { type: 'money', required: true },
  provisionCharges: { type: 'money', required: true },
  depotGarantie: { type: 'money', required: true },
  travauxMention: { type: 'string', required: false },
  garantiesMention: { type: 'string', required: false },
  clausesLegalesTexteValide: { type: 'locked', required: true },
  honorairesMention: { type: 'string', required: true },
  listeAnnexes: { type: 'string', required: true },
} as const;
