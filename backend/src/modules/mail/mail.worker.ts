import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EmailStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventResolver } from './event.resolver';
import { MAIL_DRIVER, type MailDriver } from './mail.driver';

/** Messages traités par passage. Assez pour ne pas prendre de retard, pas assez pour saturer le prestataire. */
const BATCH_SIZE = 20;

/**
 * Tentatives avant abandon.
 *
 * Cinq, espacées : une boîte pleine se vide, un serveur tombé se relève. Au-delà
 * c'est une adresse morte ou une configuration fautive, et réessayer
 * indéfiniment ferait passer le domaine pour un émetteur de spam.
 */
const MAX_ATTEMPTS = 5;

/** Attente avant nouvelle tentative : 1, 5, 25 puis 125 minutes. */
const backoffMs = (attempts: number) => 60_000 * 5 ** (attempts - 1);

/**
 * Vide la file des notifications.
 *
 * Un intervalle plutôt qu'un `cron` : la cadence compte, l'heure non. Et une
 * boucle en base plutôt qu'une file dédiée (Redis, BullMQ) — le volume du
 * pilote ne la justifie pas, et une dépendance de plus se paie en exploitation.
 * Le jour où elle se justifiera, seule cette classe changera : le reste du code
 * ne connaît que `MailService.enqueue`.
 */
@Injectable()
export class MailWorker {
  private readonly logger = new Logger(MailWorker.name);
  /** Empêche deux passages de se chevaucher si l'un traîne. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: EventResolver,
    @Inject(MAIL_DRIVER) private readonly driver: MailDriver,
  ) {}

  @Interval('mail-queue', 30_000)
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.emailMessage.findMany({
        where: {
          status: EmailStatus.PENDING,
          subjectRef: { not: null },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          template: true,
          subjectRef: true,
          recipientId: true,
          attempts: true,
        },
      });

      for (const message of due) {
        await this.deliver(message);
      }
    } catch (error) {
      this.logger.error(`Passage de la file interrompu : ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async deliver(message: {
    id: string;
    template: string;
    subjectRef: string | null;
    recipientId: string | null;
    attempts: number;
  }): Promise<void> {
    const attempts = message.attempts + 1;

    let resolved;
    try {
      resolved = await this.resolver.resolve(
        message.template,
        message.subjectRef,
        message.recipientId,
      );
    } catch (error) {
      await this.fail(message.id, attempts, `Contenu irrécupérable : ${(error as Error).message}`);
      return;
    }

    if (!resolved) {
      // L'objet a disparu, ou la situation a changé au point que le message
      // n'aurait plus de sens. Abandonné plutôt que réessayé : réessayer ne le
      // fera pas réapparaître.
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: EmailStatus.FAILED,
          attempts,
          nextAttemptAt: null,
          lastError: 'Sans objet à l’envoi : abandonné.',
        },
      });
      return;
    }

    try {
      await this.driver.send({
        to: resolved.to,
        subject: resolved.message.subject,
        html: resolved.message.html,
        text: resolved.message.text,
      });

      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: EmailStatus.SENT,
          attempts,
          subject: resolved.message.subject,
          sentAt: new Date(),
          nextAttemptAt: null,
          driver: this.driver.name,
        },
      });
    } catch (error) {
      await this.fail(message.id, attempts, (error as Error).message);
    }
  }

  private async fail(id: string, attempts: number, reason: string): Promise<void> {
    const exhausted = attempts >= MAX_ATTEMPTS;
    await this.prisma.emailMessage.update({
      where: { id },
      data: {
        status: exhausted ? EmailStatus.FAILED : EmailStatus.PENDING,
        attempts,
        nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts)),
        lastError: reason.slice(0, 500),
      },
    });

    // Le destinataire n'apparaît pas dans le log : une adresse e-mail est une
    // donnée personnelle, et les logs se recopient.
    this.logger[exhausted ? 'error' : 'warn'](
      `Envoi ${id} en échec (tentative ${attempts}/${MAX_ATTEMPTS})${exhausted ? ', abandonné' : ''} : ${reason}`,
    );
  }
}
