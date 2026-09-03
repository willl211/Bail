import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { VideoDriver, VideoRoom, VideoRoomInput } from './video.driver';

/**
 * Prestataire de visio simulé.
 *
 * Aucun prestataire n'est retenu (docs/integrations.md) : ce driver tient la
 * place, et l'interface l'annonce au locataire — la salle porte une URL
 * manifestement locale, pas un lien qui laisserait croire à un vrai rendez-vous
 * en visio.
 *
 * Aucun état conservé : les salles vivent en base, côté `Visit`. Un mock qui
 * tiendrait son propre registre en mémoire perdrait tout au redémarrage et
 * ferait croire à des salles disparues.
 */
@Injectable()
export class MockVideoDriver implements VideoDriver {
  readonly name = 'mock';

  private readonly logger = new Logger(MockVideoDriver.name);

  async createRoom(input: VideoRoomInput): Promise<VideoRoom> {
    const id = `room-${randomUUID().slice(0, 12)}`;
    this.logger.log(
      `[mock] salle ${id} pour la visite ${input.visitId}, purge le ${input.recordingExpiresAt.toISOString()}`,
    );

    return {
      id,
      // `.invalid` est réservé par la RFC 2606 : l'adresse ne résoudra jamais,
      // et personne ne la prendra pour un vrai lien de visioconférence.
      url: `https://visio.bail.invalid/${id}`,
      expiresAt: input.recordingExpiresAt,
    };
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.logger.log(`[mock] salle ${roomId} fermée et enregistrement purgé`);
  }
}
