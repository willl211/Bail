/**
 * Contrat du prestataire de signature électronique.
 *
 * DocuSign est retenu (docs/integrations.md), mais aucun compte n'est branché :
 * `mock` reste le driver par défaut. Toute la logique métier passe par cette
 * interface, jamais par un SDK — brancher DocuSign ne doit demander que des
 * variables d'environnement.
 *
 * Ce que le contrat impose et qui n'est pas négociable :
 *
 *  - le document signé est **figé** : on envoie un contenu et son empreinte,
 *    et c'est sur cette empreinte que porte la signature. Un prestataire qui
 *    laisserait modifier le document après envoi rendrait la signature sans
 *    valeur ;
 *  - la **preuve** revient avec le document signé : horodatage et identité des
 *    signataires. Sans elle, on a un PDF, pas un acte.
 */

export interface SignatureSigner {
  /** Identifiant interne du signataire, renvoyé tel quel dans les événements. */
  id: string;
  fullName: string;
  email: string;
  role: 'LANDLORD' | 'TENANT';
}

export interface SignatureEnvelopeInput {
  /** Référence du bail, lisible dans le tableau de bord du prestataire. */
  reference: string;
  subject: string;
  /** Document à signer. */
  document: { fileName: string; content: Buffer; mimeType: string };
  /** Empreinte SHA-256 du document : ce sur quoi la signature porte. */
  checksum: string;
  signers: SignatureSigner[];
  /** Au-delà, l'enveloppe expire et doit être renvoyée. */
  expiresInDays: number;
}

export interface SignatureEnvelope {
  id: string;
  status: 'sent' | 'delivered' | 'completed' | 'declined' | 'voided';
  /** URL de signature par signataire, quand le prestataire en fournit. */
  signingUrls: Record<string, string>;
  expiresAt: Date;
}

export interface SignatureEvent {
  id: string;
  envelopeId: string;
  type: 'sent' | 'delivered' | 'signed' | 'completed' | 'declined' | 'voided';
  /** Signataire concerné, pour les événements qui en visent un. */
  signerId: string | null;
  occurredAt: Date;
  reason: string | null;
}

export const SIGNATURE_DRIVER = Symbol('SIGNATURE_DRIVER');

export interface SignatureDriver {
  /** Nom du driver, exposé par `/health` pour savoir ce qui tourne. */
  readonly name: string;

  createEnvelope(input: SignatureEnvelopeInput): Promise<SignatureEnvelope>;

  /**
   * Annule une enveloppe en cours.
   *
   * Nécessaire : un bail dont les champs se révèlent faux après envoi doit
   * pouvoir être retiré de la signature, pas seulement ignoré.
   */
  voidEnvelope(envelopeId: string, reason: string): Promise<void>;

  /**
   * Vérifie l'authenticité d'une notification et renvoie l'événement.
   *
   * La vérification n'est pas une formalité : sans elle, n'importe qui
   * pourrait déclarer un bail signé.
   */
  parseEvent(payload: Buffer, signature: string | undefined): SignatureEvent;

  /** Récupère le document signé et sa preuve, une fois l'enveloppe complète. */
  downloadSigned(envelopeId: string): Promise<{ content: Buffer; mimeType: string }>;
}
