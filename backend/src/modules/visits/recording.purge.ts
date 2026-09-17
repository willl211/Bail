import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { VIDEO_DRIVER, type VideoDriver } from '../video/video.driver';

/** Enregistrements traités par passage, pour ne pas bloquer sur un gros retard. */
const BATCH_SIZE = 50;

/**
 * Purge des enregistrements de visite arrivés à échéance.
 *
 * `Visit.recordingExpiresAt` était posée à l'ouverture de la salle depuis
 * l'écran 5, mais **rien ne la balayait** : la rétention de 15 jours annoncée au
 * locataire, au propriétaire et dans le back-office n'était qu'une date en base.
 * Une durée de conservation qu'aucune tâche n'applique n'est pas une durée de
 * conservation.
 *
 * La purge efface le fichier **et** la clé qui y menait, puis horodate le
 * passage : sans `recordingPurgedAt`, on ne pourrait pas prouver que l'effacement
 * a bien eu lieu — or c'est précisément ce qu'une autorité de contrôle demande.
 *
 * Un passage par minute traite aussi les salles annulées. Un échec reste en
 * attente : seul un effacement confirmé permet de retirer les références.
 */
@Injectable()
export class RecordingPurge {
  private readonly logger = new Logger(RecordingPurge.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(VIDEO_DRIVER) private readonly video: VideoDriver,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'recording-purge' })
  async purge(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const expired = await this.prisma.visit.findMany({
        where: {
          recordingPurgedAt: null,
          AND: [
            { OR: [{ recordingStorageKey: { not: null } }, { videoRoomId: { not: null } }] },
            { OR: [{ recordingExpiresAt: { lte: new Date() } }, { status: 'CANCELLED' }] },
          ],
        },
        orderBy: { updatedAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, recordingStorageKey: true, videoRoomId: true, videoProvider: true },
      });

      if (expired.length === 0) return;

      let purged = 0;
      for (const visit of expired) {
        try {
          if (visit.videoRoomId) {
            if (visit.videoProvider !== this.video.name)
              throw new Error('Prestataire de la salle indisponible.');
            await this.video.deleteRoom(visit.videoRoomId);
          }
          if (visit.recordingStorageKey)
            await this.storage.removeRequired('private', visit.recordingStorageKey);
        } catch (error) {
          this.logger.warn(`Purge ${visit.id} à reprendre : ${(error as Error).message}`);
          // Garder les références pour réessayer, sans bloquer tout le lot.
          await this.prisma.visit.update({
            where: { id: visit.id },
            data: { updatedAt: new Date() },
          });
          continue;
        }

        await this.prisma.visit.updateMany({
          where: {
            id: visit.id,
            recordingStorageKey: visit.recordingStorageKey,
            videoRoomId: visit.videoRoomId,
            recordingPurgedAt: null,
          },
          data: {
            recordingStorageKey: null,
            videoRoomId: null,
            videoRoomUrl: null,
            recordingPurgedAt: new Date(),
          },
        });
        purged += 1;
      }

      this.logger.log(`Purge des enregistrements : ${purged} effacé(s).`);
    } catch (error) {
      this.logger.error(`Purge des enregistrements interrompue : ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
