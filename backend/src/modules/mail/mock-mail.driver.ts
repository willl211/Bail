import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MailDriver, OutgoingEmail, SentEmail } from './mail.driver';

/**
 * Simulateur d'envoi.
 *
 * Il **écrit chaque message sur disque** au lieu de le jeter dans les logs :
 * un e-mail se juge sur son rendu, ses liens et sa mise en page, et une ligne
 * de log n'en montre rien. Les fichiers atterrissent dans le stockage privé,
 * jamais servi statiquement — un lien de réinitialisation traîne dedans.
 *
 * Le sujet et le destinataire partent tout de même dans le log, pour qu'on voie
 * passer les envois pendant un parcours sans ouvrir un dossier.
 */
export class MockMailDriver implements MailDriver {
  readonly name = 'mock';
  private readonly logger = new Logger(MockMailDriver.name);

  constructor(private readonly storageRoot: string) {}

  async send(email: OutgoingEmail): Promise<SentEmail> {
    const id = randomUUID();
    const directory = resolve(this.storageRoot, 'private', 'mails');
    await mkdir(directory, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = email.to.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    const base = join(directory, `${stamp}_${slug}`);

    // L'en-tête est repris dans le fichier HTML : ouvert dans un navigateur, il
    // doit dire à qui le message était destiné, pas seulement à quoi il
    // ressemblait.
    const header =
      `<!-- À : ${email.to}\n     Objet : ${email.subject}\n` +
      `     Envoi simulé : aucun message n'a quitté la machine. -->\n`;

    await Promise.all([
      writeFile(`${base}.html`, header + email.html, 'utf8'),
      writeFile(`${base}.txt`, `À : ${email.to}\nObjet : ${email.subject}\n\n${email.text}`, 'utf8'),
    ]);

    this.logger.log(`E-mail simulé → ${email.to} · « ${email.subject} » · ${base}.html`);
    return { providerId: `mock_${id}` };
  }
}
