import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmailStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { EventKey } from './event.templates';
import { MAIL_DRIVER, type MailDriver } from './mail.driver';
import type { RenderedTemplate, TemplateKey } from './mail.templates';

export interface SendOptions {
  template: TemplateKey;
  to: string;
  /** Destinataire connu, pour retrouver ses envois. Absent si le compte n'existe pas. */
  userId?: string;
  message: RenderedTemplate;
}

export interface EnqueueOptions {
  template: EventKey;
  /** Compte à prévenir. Le contenu sera relu à l'envoi à partir de son profil. */
  userId: string;
  /** Identifiant de l'objet concerné — candidature, visite, bien. */
  subjectRef: string;
  /**
   * Identité de l'événement, quand l'objet seul ne suffit pas à le distinguer.
   *
   * Une candidature ne se signale qu'une fois, mais une même pièce peut être
   * refusée, corrigée, puis refusée à nouveau : la clé doit alors porter la
   * date de décision, sans quoi le second refus serait avalé comme un doublon.
   */
  dedupeKey?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_DRIVER) private readonly driver: MailDriver,
  ) {}

  /** `true` quand aucun message ne quitte réellement la machine. */
  get isSimulated(): boolean {
    return this.driver.name === 'mock';
  }

  /**
   * Envoie immédiatement, et consigne l'envoi.
   *
   * Immédiatement, et non par une file d'attente : ces messages portent un lien
   * à usage unique, et une file devrait donc stocker ce lien en base. Un lien
   * de réinitialisation en base vaut un mot de passe en clair — c'est
   * exactement ce que le modèle `Session` s'interdit depuis le début. Les
   * notifications d'événements, elles, ne portent aucun secret et pourront
   * passer par une file.
   *
   * **Ne lève jamais.** Un échec d'envoi ne doit pas faire échouer l'action qui
   * l'a déclenché : une création de compte réussie doit le rester même si le
   * serveur SMTP est tombé. L'échec est consigné, et l'utilisateur peut
   * redemander le message.
   */
  async send(options: SendOptions): Promise<boolean> {
    const record = await this.prisma.emailMessage.create({
      data: {
        template: options.template,
        recipientEmail: options.to,
        recipientId: options.userId ?? null,
        subject: options.message.subject,
        driver: this.driver.name,
      },
      select: { id: true },
    });

    try {
      await this.driver.send({
        to: options.to,
        subject: options.message.subject,
        html: options.message.html,
        text: options.message.text,
      });

      await this.prisma.emailMessage.update({
        where: { id: record.id },
        data: { status: EmailStatus.SENT, attempts: 1, sentAt: new Date() },
      });
      return true;
    } catch (error) {
      const reason = (error as Error).message ?? 'Erreur inconnue';
      await this.prisma.emailMessage.update({
        where: { id: record.id },
        data: { status: EmailStatus.FAILED, attempts: 1, lastError: reason.slice(0, 500) },
      });
      // Le destinataire n'apparaît pas dans le log d'erreur : une adresse
      // e-mail est une donnée personnelle, et les logs se recopient.
      this.logger.error(`Envoi « ${options.template} » échoué : ${reason}`);
      return false;
    }
  }

  /**
   * Met une notification en file.
   *
   * Rien n'est rendu ni envoyé ici : c'est le point du dispositif. Une
   * candidature ne doit pas échouer parce qu'un serveur SMTP est lent, et
   * l'appelant n'a pas à attendre un réseau tiers pour rendre la main. La ligne
   * ne porte qu'une référence — le contenu est reconstruit à l'envoi.
   *
   * Ne lève jamais, y compris sur un doublon : c'est le comportement attendu,
   * pas une erreur.
   */
  async enqueue(options: EnqueueOptions): Promise<void> {
    const recipient = await this.prisma.user.findUnique({
      where: { id: options.userId },
      select: { email: true, isActive: true },
    });
    if (!recipient?.isActive) return;

    try {
      await this.prisma.emailMessage.create({
        data: {
          template: options.template,
          recipientEmail: recipient.email,
          recipientId: options.userId,
          subjectRef: options.subjectRef,
          dedupeKey: options.dedupeKey ?? `${options.template}:${options.subjectRef}`,
          driver: this.driver.name,
          nextAttemptAt: new Date(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Événement déjà en file ou déjà parti : c'est précisément ce que la
        // contrainte d'unicité doit produire.
        return;
      }
      // Un échec de mise en file ne remonte pas non plus : il ne doit pas
      // annuler l'action métier qui vient d'aboutir.
      this.logger.error(
        `Mise en file « ${options.template} » impossible : ${(error as Error).message}`,
      );
    }
  }

  /**
   * Nombre d'envois d'un gabarit à une adresse depuis un moment donné.
   *
   * Sert à limiter les renvois : sans ça, le formulaire « mot de passe oublié »
   * devient un moyen d'inonder la boîte de quelqu'un d'autre.
   */
  countSince(template: TemplateKey, to: string, since: Date): Promise<number> {
    return this.prisma.emailMessage.count({
      where: { template, recipientEmail: to, createdAt: { gte: since } },
    });
  }
}
