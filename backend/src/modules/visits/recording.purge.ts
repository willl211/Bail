import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

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
 * Une heure fixe plutôt qu'un intervalle : le passage doit être identifiable
 * dans un journal d'exploitation, et une purge quotidienne à 3 h du matin se
 * raconte, contrairement à « toutes les 30 minutes ».
 */
@Injectable()
export class RecordingPurge {
  private readonly logger = new Logger(RecordingPurge.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'recording-purge' })
  async purge(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const expired = await this.prisma.visit.findMany({
        where: {
          recordingStorageKey: { not: null },
          recordingPurgedAt: null,
          recordingExpiresAt: { lte: new Date() },
        },
        take: BATCH_SIZE,
        select: { id: true, recordingStorageKey: true },
      });

      if (expired.length === 0) return;

      let purged = 0;
      for (const visit of expired) {
        try {
          await this.storage.remove('private', visit.recordingStorageKey as string);
        } catch (error) {
          // Un fichier déjà absent n'empêche pas de clore la purge : ce qui
          // compte est qu'il ne soit plus là, pas qu'on l'ait supprimé
          // nous-mêmes. En revanche, la clé doit disparaître de la base.
          this.logger.warn(
            `Enregistrement ${visit.id} introuvable au stockage : ${(error as Error).message}`,
          );
        }

        await this.prisma.visit.update({
          where: { id: visit.id },
          data: { recordingStorageKey: null, recordingPurgedAt: new Date() },
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
