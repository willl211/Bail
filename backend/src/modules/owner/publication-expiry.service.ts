import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../payments/subscription.service';
import { diagnosticVisibilityWhere } from './diagnostic-policy';
import { publicationChecks } from './property.checks';

@Injectable()
export class PublicationExpiryService {
  private readonly logger = new Logger(PublicationExpiryService.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly subscriptions: SubscriptionService) {}

  @Interval('publication-expiry', 60_000)
  async reconcile(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const properties = await this.prisma.property.findMany({
        where: { status: { in: ['ONLINE', 'VISITS_IN_PROGRESS'] }, OR: [{ energyRating: null }, { constructionYear: null }, { NOT: diagnosticVisibilityWhere(now) }] },
        include: { documents: true, photos: true }, orderBy: { id: 'asc' }, take: 100,
      });
      for (const property of properties) {
        const note = 'Diffusion interrompue : ' + publicationChecks(property, now).blockers.join(' · ');
        await this.prisma.$transaction(async (tx) => {
          const changed = await tx.property.updateMany({
            where: { id: property.id, status: property.status, reviewRevision: property.reviewRevision },
            data: { status: 'DRAFT', reviewNote: note, reviewRevision: { increment: 1 }, publicationBillingSyncPending: true },
          });
          if (!changed.count) return;
          await tx.propertyReviewEvent.create({ data: {
            propertyId: property.id, revision: property.reviewRevision + 1, actorLabel: 'Contrôle automatique',
            action: 'PUBLICATION_SUSPENDED', title: 'Annonce retirée de la diffusion', note,
          } });
        });
      }
      // Marqueur durable : un échec du prestataire sera repris au prochain passage.
      const pending = await this.prisma.property.findMany({
        where: { publicationBillingSyncPending: true }, select: { id: true, ownerId: true, reviewRevision: true }, take: 100,
      });
      for (const ownerId of new Set(pending.map((property) => property.ownerId))) {
        try {
          await this.subscriptions.syncQuantity(ownerId);
          for (const property of pending.filter((entry) => entry.ownerId === ownerId)) {
            await this.prisma.property.updateMany({
              where: { id: property.id, reviewRevision: property.reviewRevision },
              data: { publicationBillingSyncPending: false },
            });
          }
        } catch { this.logger.warn('Synchronisation de facturation à reprendre après suspension.'); }
      }
    } catch { this.logger.error('Contrôle des annonces interrompu ; nouvel essai au prochain passage.'); }
    finally { this.running = false; }
  }
}
