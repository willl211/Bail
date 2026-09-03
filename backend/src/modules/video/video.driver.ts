/**
 * Contrat du prestataire de visio.
 *
 * Aucun prestataire n'est formellement retenu — `docs/integrations.md`
 * recommande Daily.co sans trancher. Toute la logique métier passe par cette
 * interface, jamais par un SDK : le jour où le choix est fait, brancher son
 * driver ne doit demander qu'une variable d'environnement.
 *
 * Deux contraintes du protocole de visite sont portées par le contrat
 * lui-même, pas laissées à l'appelant :
 *
 *  - la **caméra est obligatoire** pendant la visite, sans option de
 *    désactivation (décision confirmée, CLAUDE.md) ;
 *  - l'**enregistrement est conservé 15 jours** puis purgé.
 *
 * D'où `expiresAt` dans la salle créée : la date de purge est décidée à
 * l'ouverture, pas espérée d'un ménage ultérieur.
 */

export interface VideoRoomInput {
  /** Référence de la visite, pour retrouver la salle côté prestataire. */
  visitId: string;
  /** Début du rendez-vous : la salle n'ouvre pas avant. */
  startsAt: Date;
  durationMinutes: number;
  /** Purge de l'enregistrement — `recordingStartedAt` + rétention. */
  recordingExpiresAt: Date;
}

export interface VideoRoom {
  /** Identifiant de la salle chez le prestataire. */
  id: string;
  /** URL rejoignable par le locataire et par l'agent. */
  url: string;
  expiresAt: Date;
}

export const VIDEO_DRIVER = Symbol('VIDEO_DRIVER');

export interface VideoDriver {
  /** Nom du driver, exposé par `/health` pour savoir ce qui tourne. */
  readonly name: string;

  createRoom(input: VideoRoomInput): Promise<VideoRoom>;

  /**
   * Ferme la salle et supprime l'enregistrement chez le prestataire.
   *
   * Appelée à l'annulation d'une visite et par la purge de rétention. Ne lève
   * pas si la salle n'existe plus : purger deux fois doit être sans effet, une
   * purge qui échoue parce que le travail est déjà fait bloquerait le ménage.
   */
  deleteRoom(roomId: string): Promise<void>;
}
