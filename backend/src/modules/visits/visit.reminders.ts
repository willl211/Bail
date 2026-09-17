import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { EVENT } from '../mail/event.templates';

@Injectable()
export class VisitReminders {
  private readonly logger = new Logger(VisitReminders.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'visit-reminders' })
  async remind(): Promise<void> {
    try {
      const now = new Date();
      const visits = await this.prisma.visit.findMany({
        where: {
          status: 'CONFIRMED',
          scheduledAt: { gt: now, lte: new Date(now.getTime() + 2 * 3600_000) },
        },
        select: { id: true, tenantId: true, agentId: true },
      });
      for (const visit of visits) {
        for (const userId of [visit.tenantId, visit.agentId].filter((id): id is string => !!id)) {
          // Le statut et le destinataire seront revérifiés au moment de l’envoi.
          await this.mail.enqueue({
            template: EVENT.visitReminder,
            userId,
            subjectRef: visit.id,
            dedupeKey: `visit-reminder:${visit.id}:${userId}`,
          });
        }
      }
    } catch (error) {
      this.logger.error(`Rappels de visite à reprendre : ${(error as Error).message}`);
    }
  }
}
