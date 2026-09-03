import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  SignatureDriver,
  SignatureEnvelope,
  SignatureEnvelopeInput,
  SignatureEvent,
} from './signature.driver';

/**
 * Prestataire de signature simulé.
 *
 * DocuSign est retenu mais aucun compte n'est branché (docs/integrations.md).
 * Ce driver tient la place, et l'interface l'annonce : aucune signature
 * produite ici n'a la moindre valeur juridique, et l'écran le dit en toutes
 * lettres plutôt que d'afficher un « signé » qui n'engagerait personne.
 *
 * Il ne signe donc **rien** tout seul. Les enveloppes restent « envoyées »
 * jusqu'à ce qu'un événement arrive — comme chez un vrai prestataire, où c'est
 * le signataire qui agit, jamais le système.
 */
@Injectable()
export class MockSignatureDriver implements SignatureDriver {
  readonly name = 'mock';

  private readonly logger = new Logger(MockSignatureDriver.name);

  async createEnvelope(input: SignatureEnvelopeInput): Promise<SignatureEnvelope> {
    if (input.signers.length === 0) {
      throw new BadRequestException('Une enveloppe sans signataire n’a pas de sens.');
    }
    if (input.document.content.length === 0) {
      throw new BadRequestException('Document vide : rien à signer.');
    }

    const id = `env_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 3600 * 1000);

    this.logger.log(
      `[mock] enveloppe ${id} — ${input.reference} — ${input.signers.length} signataire(s)`,
    );

    return {
      id,
      status: 'sent',
      // `.invalid` est réservé par la RFC 2606 : l'adresse ne résoudra jamais,
      // et personne ne la prendra pour un vrai lien de signature.
      signingUrls: Object.fromEntries(
        input.signers.map((signer) => [
          signer.id,
          `https://signature.bail.invalid/${id}/${signer.id}`,
        ]),
      ),
      expiresAt,
    };
  }

  async voidEnvelope(envelopeId: string, reason: string): Promise<void> {
    this.logger.log(`[mock] enveloppe ${envelopeId} annulée : ${reason}`);
  }

  parseEvent(payload: Buffer): SignatureEvent {
    // Pas de signature à vérifier sans prestataire réel, mais la charge doit
    // rester un JSON valide : accepter n'importe quoi masquerait des erreurs de
    // format qui exploseraient en production.
    let body: {
      id?: string;
      envelopeId?: string;
      type?: SignatureEvent['type'];
      signerId?: string;
      reason?: string;
    };
    try {
      body = JSON.parse(payload.toString('utf8')) as typeof body;
    } catch {
      throw new BadRequestException('Charge de notification illisible.');
    }

    if (!body.envelopeId) throw new BadRequestException('Enveloppe manquante.');
    if (!body.type) throw new BadRequestException('Type d’événement manquant.');

    return {
      id: body.id ?? `evt_${randomUUID().slice(0, 12)}`,
      envelopeId: body.envelopeId,
      type: body.type,
      signerId: body.signerId ?? null,
      occurredAt: new Date(),
      reason: body.reason ?? null,
    };
  }

  async downloadSigned(envelopeId: string): Promise<{ content: Buffer; mimeType: string }> {
    // Aucun document signé n'existe : en fabriquer un ressemblerait à une
    // preuve, et n'en serait pas une.
    throw new BadRequestException(
      `Aucun document signé disponible pour ${envelopeId} : le prestataire de signature est simulé.`,
    );
  }
}
