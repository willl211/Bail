/**
 * Contrat du prestataire d'envoi d'e-mails.
 *
 * Volontairement minuscule : un message à envoyer, un identifiant en retour.
 * Tout ce qui relève du produit — quels e-mails existent, ce qu'ils disent, à
 * qui ils partent — vit dans les gabarits et le service, jamais dans le driver.
 * Changer de prestataire ne doit toucher qu'une classe.
 */
export const MAIL_DRIVER = Symbol('MAIL_DRIVER');

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Corps HTML. */
  html: string;
  /**
   * Corps texte brut, toujours fourni. Ce n'est pas une politesse : certains
   * clients ne rendent pas le HTML, et un message sans partie texte est noté
   * comme suspect par les filtres anti-spam.
   */
  text: string;
}

export interface SentEmail {
  /** Identifiant rendu par le prestataire, pour retrouver un envoi contesté. */
  providerId: string;
}

export interface MailDriver {
  /** Nom du driver, journalisé avec chaque envoi. */
  readonly name: string;
  send(email: OutgoingEmail): Promise<SentEmail>;
}
