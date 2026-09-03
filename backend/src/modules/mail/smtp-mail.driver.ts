import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { MailDriver, OutgoingEmail, SentEmail } from './mail.driver';

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}

/**
 * Envoi par SMTP.
 *
 * C'est le seul driver réel du projet écrit avant qu'un compte n'existe, et
 * c'est assumé : contrairement à DocuSign, SMTP est un protocole, pas une API
 * propriétaire. Il se vérifie de bout en bout contre Mailpit — connexion,
 * en-têtes, encodage, rendu — et la même classe parlera ensuite à Brevo,
 * Mailjet ou SES sans une ligne de plus. Seules les variables changent.
 */
export class SmtpMailDriver implements MailDriver {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpMailDriver.name);
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      // L'authentification est facultative : Mailpit n'en demande pas, un
      // prestataire en exige toujours une.
      auth: options.user ? { user: options.user, pass: options.password } : undefined,
    });
  }

  /**
   * Vérifie que le serveur répond. Appelée au démarrage, sans faire échouer le
   * lancement : une API qui refuse de démarrer parce qu'un serveur SMTP est
   * momentanément injoignable rendrait tout le site indisponible pour un
   * canal accessoire.
   */
  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP joignable sur ${this.options.host}:${this.options.port}.`);
    } catch (error) {
      this.logger.warn(
        `SMTP injoignable sur ${this.options.host}:${this.options.port} — ` +
          `les e-mails échoueront tant que ce n'est pas corrigé. ${(error as Error).message}`,
      );
    }
  }

  async send(email: OutgoingEmail): Promise<SentEmail> {
    const info = await this.transporter.sendMail({
      from: this.options.from,
      replyTo: this.options.replyTo,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    return { providerId: info.messageId };
  }
}
