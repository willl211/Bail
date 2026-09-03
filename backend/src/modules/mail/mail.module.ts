import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { MAIL_DRIVER, type MailDriver } from './mail.driver';
import { MockMailDriver } from './mock-mail.driver';
import { SmtpMailDriver } from './smtp-mail.driver';

/**
 * Module d'envoi d'e-mails.
 *
 * Le driver est choisi au démarrage par `MAIL_DRIVER`, et un nom inconnu fait
 * échouer le lancement plutôt que de retomber sur le simulateur — sans quoi une
 * faute de frappe en production ferait taire toutes les notifications sans que
 * rien ne le signale.
 *
 * Contrairement aux autres intégrations, celle-ci a un driver **réel** dès
 * maintenant : SMTP est un protocole, pas une API propriétaire, et il se
 * vérifie contre Mailpit (`docker compose up -d mailpit`, interface sur
 * http://localhost:8025) sans compte chez quiconque.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailDriver => {
        const name = config.get<string>('mail.driver', 'mock');

        if (name === 'mock') {
          Logger.log(
            'E-mails : driver simulé, écrits dans storage/private/mails/.',
            'MailModule',
          );
          return new MockMailDriver(config.get<string>('storage.localPath', './storage'));
        }

        if (name === 'smtp') {
          const driver = new SmtpMailDriver({
            host: config.get<string>('mail.smtp.host', 'localhost'),
            port: config.get<number>('mail.smtp.port', 1025),
            secure: config.get<boolean>('mail.smtp.secure', false),
            user: config.get<string | undefined>('mail.smtp.user'),
            password: config.get<string | undefined>('mail.smtp.password'),
            from: config.get<string>('mail.from', 'Bail <ne-pas-repondre@bail.local>'),
            replyTo: config.get<string | undefined>('mail.replyTo'),
          });
          // Vérification non bloquante : une API qui refuserait de démarrer
          // parce qu'un serveur SMTP est momentanément muet rendrait tout le
          // site indisponible pour un canal accessoire.
          void driver.verify();
          return driver;
        }

        throw new Error(
          `MAIL_DRIVER="${name}" inconnu. Valeurs acceptées : "mock" (écriture sur disque) ou "smtp".`,
        );
      },
    },
    MailService,
  ],
  exports: [MAIL_DRIVER, MailService],
})
export class MailModule {}
