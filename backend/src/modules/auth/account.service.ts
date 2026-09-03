import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenPurpose, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  TEMPLATE,
  emailVerification,
  passwordChanged,
  passwordReset,
} from '../mail/mail.templates';
import { AuthService } from './auth.service';
import { hashSecret, newSecret } from './tokens';

/** Validité d'un lien de confirmation d'adresse. */
const VERIFICATION_TTL_HOURS = 24;
/**
 * Validité d'un lien de réinitialisation. Court à dessein : ce lien vaut un mot
 * de passe, et il transite par une boîte aux tiroirs de laquelle on ne maîtrise
 * rien.
 */
const RESET_TTL_MINUTES = 60;

/**
 * Nombre d'envois d'un même gabarit à une même adresse par heure.
 *
 * Sans plafond, ces deux formulaires publics deviennent un moyen d'inonder la
 * boîte de n'importe qui : il suffit de connaître son adresse.
 */
const MAX_SENDS_PER_HOUR = 3;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
  ) {}

  private get siteUrl(): string {
    return this.config.get<string>('siteUrl', 'http://localhost:3000');
  }

  /**
   * Émet un jeton à usage unique.
   *
   * Les jetons du même usage encore valides sont consommés au passage : demander
   * un nouveau lien doit invalider le précédent, sinon un lien intercepté reste
   * exploitable alors que son destinataire croit l'avoir remplacé.
   */
  private async issueToken(
    userId: string,
    purpose: AuthTokenPurpose,
    ttlMs: number,
    ipAddress?: string,
  ): Promise<string> {
    const secret = newSecret();

    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.authToken.create({
        data: {
          tokenHash: hashSecret(secret),
          purpose,
          userId,
          expiresAt: new Date(Date.now() + ttlMs),
          ipAddress,
        },
      }),
    ]);

    return secret;
  }

  /**
   * Consomme un jeton. Renvoie `null` pour tout jeton inconnu, expiré ou déjà
   * utilisé, sans distinguer les trois : l'écran n'a rien à gagner à préciser
   * lequel des trois cas s'applique.
   */
  private async consumeToken(
    secret: string,
    purpose: AuthTokenPurpose,
  ): Promise<User | null> {
    const token = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashSecret(secret) },
      include: { user: true },
    });

    if (!token || token.purpose !== purpose) return null;
    if (token.consumedAt || token.expiresAt <= new Date()) return null;
    if (!token.user.isActive) return null;

    // `updateMany` avec la condition « pas encore consommé » : deux clics
    // simultanés sur le lien ne doivent le valider qu'une fois.
    const { count } = await this.prisma.authToken.updateMany({
      where: { id: token.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) return null;

    return token.user;
  }

  private async withinQuota(template: string, email: string): Promise<boolean> {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sent = await this.mail.countSince(
      template as (typeof TEMPLATE)[keyof typeof TEMPLATE],
      email,
      anHourAgo,
    );
    return sent < MAX_SENDS_PER_HOUR;
  }

  // ------------------------------------------------- Confirmation d'adresse

  /**
   * Envoie (ou renvoie) le lien de confirmation.
   *
   * Silencieux si l'adresse est déjà confirmée : renvoyer un lien inutile
   * inquiéterait pour rien.
   */
  async sendVerification(user: {
    id: string;
    email: string;
    firstName: string;
    emailVerifiedAt: Date | null;
  }): Promise<void> {
    if (user.emailVerifiedAt) return;
    if (!(await this.withinQuota(TEMPLATE.emailVerification, user.email))) {
      throw new ConflictException(
        'Un lien de confirmation vient de vous être envoyé. Vérifiez vos courriers indésirables avant d’en redemander un.',
      );
    }

    const secret = await this.issueToken(
      user.id,
      AuthTokenPurpose.EMAIL_VERIFICATION,
      VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    );

    await this.mail.send({
      template: TEMPLATE.emailVerification,
      to: user.email,
      userId: user.id,
      message: emailVerification({
        firstName: user.firstName,
        url: `${this.siteUrl}/verification-email?jeton=${encodeURIComponent(secret)}`,
        validHours: VERIFICATION_TTL_HOURS,
      }),
    });
  }

  async verifyEmail(secret: string): Promise<{ email: string }> {
    const user = await this.consumeToken(secret, AuthTokenPurpose.EMAIL_VERIFICATION);
    if (!user) {
      throw new BadRequestException(
        'Ce lien de confirmation n’est plus valable. Demandez-en un nouveau depuis votre compte.',
      );
    }

    // `updateMany` plutôt qu'`update` : confirmer deux fois ne doit pas écraser
    // la date d'origine, qui est une trace d'audit.
    await this.prisma.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });

    this.logger.log(`Adresse confirmée : ${user.id}`);
    return { email: user.email };
  }

  // -------------------------------------------------- Mot de passe oublié

  /**
   * Demande de réinitialisation.
   *
   * Ne renvoie **jamais** d'information sur l'existence du compte, quoi qu'il
   * arrive : ce formulaire est public, et une réponse différente selon que
   * l'adresse existe ou non en ferait un annuaire des clients de la
   * plateforme.
   */
  async requestPasswordReset(email: string, ipAddress?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive || !user.passwordHash) {
      this.logger.log('Réinitialisation demandée pour une adresse sans compte utilisable.');
      return;
    }
    if (!(await this.withinQuota(TEMPLATE.passwordReset, user.email))) {
      // Le plafond est atteint : on s'arrête sans le dire, pour la même raison
      // que ci-dessus.
      this.logger.warn('Réinitialisation : plafond horaire atteint pour une adresse.');
      return;
    }

    const secret = await this.issueToken(
      user.id,
      AuthTokenPurpose.PASSWORD_RESET,
      RESET_TTL_MINUTES * 60 * 1000,
      ipAddress,
    );

    await this.mail.send({
      template: TEMPLATE.passwordReset,
      to: user.email,
      userId: user.id,
      message: passwordReset({
        firstName: user.firstName,
        url: `${this.siteUrl}/mot-de-passe/reinitialiser?jeton=${encodeURIComponent(secret)}`,
        validMinutes: RESET_TTL_MINUTES,
      }),
    });
  }

  async resetPassword(secret: string, password: string): Promise<void> {
    const user = await this.consumeToken(secret, AuthTokenPurpose.PASSWORD_RESET);
    if (!user) {
      throw new BadRequestException(
        'Ce lien de réinitialisation n’est plus valable. Demandez-en un nouveau.',
      );
    }

    await this.applyNewPassword(user, password);
  }

  // ------------------------------------------------ Changement volontaire

  async changePassword(
    userId: string,
    currentPassword: string,
    password: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new UnauthorizedException('Compte introuvable.');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Mot de passe actuel incorrect.');

    if (await bcrypt.compare(password, user.passwordHash)) {
      throw new BadRequestException('Le nouveau mot de passe doit différer de l’ancien.');
    }

    await this.applyNewPassword(user, password);
  }

  /**
   * Écrit le nouveau mot de passe, ferme les sessions et prévient le titulaire.
   *
   * Les trois vont ensemble. Fermer les sessions est ce qui donne son sens au
   * choix de la session plutôt que du JWT : si le compte était détourné,
   * changer le mot de passe doit couper l'accès de l'intrus dans la seconde. Et
   * la notification est le seul moyen pour le titulaire de s'apercevoir qu'un
   * changement qu'il n'a pas demandé a eu lieu.
   */
  private async applyNewPassword(user: User, password: string): Promise<void> {
    const passwordHash = await bcrypt.hash(
      password,
      this.config.get<number>('auth.passwordSaltRounds', 12),
    );

    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    const revokedSessions = await this.auth.revokeAllSessions(user.id);

    await this.mail.send({
      template: TEMPLATE.passwordChanged,
      to: user.email,
      userId: user.id,
      message: passwordChanged({
        firstName: user.firstName,
        changedAt: new Date(),
        revokedSessions,
        supportUrl: `${this.siteUrl}/mentions-legales`,
      }),
    });

    this.logger.log(`Mot de passe changé : ${user.id} (${revokedSessions} session(s) fermée(s))`);
  }
}
