import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountService } from './account.service';
import { AuthService, PublicUser, SessionResult } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/account.dto';
import { CurrentUser, Public, RequestWithUser } from './session.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Options du cookie de session.
   *
   * `httpOnly` interdit toute lecture par JavaScript : même une faille XSS ne
   * permet pas d'exfiltrer la session. `sameSite: 'lax'` bloque les requêtes
   * inter-sites en écriture — la protection CSRF de base — tout en laissant
   * fonctionner l'arrivée sur le site depuis un lien externe.
   */
  private cookieOptions(expiresAt?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('auth.cookieSecure', true),
      sameSite: 'lax',
      domain: this.config.get<string | undefined>('auth.cookieDomain'),
      path: '/',
      ...(expiresAt ? { expires: expiresAt } : {}),
    };
  }

  private setSession(response: Response, session: SessionResult) {
    response.cookie(
      this.config.get<string>('auth.cookieName', 'bail_session'),
      session.token,
      this.cookieOptions(session.expiresAt),
    );
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser }> {
    const session = await this.auth.register(dto, {
      userAgent: request.get('user-agent') ?? undefined,
      ipAddress: request.ip,
    });

    // Le lien de confirmation part tout de suite, mais son échec ne remet pas
    // en cause l'inscription : `MailService.send` ne lève pas, et l'écran
    // propose de renvoyer le message.
    await this.account.sendVerification({
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      emailVerifiedAt: null,
    });

    this.setSession(response, session);
    return { user: session.user };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser }> {
    const session = await this.auth.login(dto, {
      userAgent: request.get('user-agent') ?? undefined,
      ipAddress: request.ip,
    });
    this.setSession(response, session);
    return { user: session.user };
  }

  /**
   * Déconnexion. Publique et sans échec : se déconnecter avec une session déjà
   * expirée ne doit pas renvoyer une erreur, sinon l'utilisateur reste coincé
   * avec un cookie mort.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(request.sessionToken);
    response.clearCookie(
      this.config.get<string>('auth.cookieName', 'bail_session'),
      this.cookieOptions(),
    );
  }

  /**
   * Profil courant. Publique à dessein : le front interroge cette route à
   * chaque rendu pour savoir quelle navigation afficher, et « personne n'est
   * connecté » est une réponse valide, pas une erreur.
   */
  @Public()
  @Get('me')
  me(@CurrentUser() user: PublicUser | null): { user: PublicUser | null } {
    return { user };
  }

  // ------------------------------------------------- Confirmation d'adresse

  /** Renvoie le lien de confirmation au titulaire du compte connecté. */
  @Post('email/verification')
  @HttpCode(204)
  async resendVerification(@CurrentUser() user: PublicUser): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
    });
    await this.account.sendVerification(record);
  }

  /**
   * Confirme l'adresse à partir du lien reçu.
   *
   * Publique : le lien s'ouvre souvent depuis un autre appareil que celui où la
   * session a été ouverte. C'est le jeton qui authentifie, pas le cookie.
   */
  @Public()
  @Post('email/verification/confirm')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ email: string }> {
    return this.account.verifyEmail(dto.token);
  }

  // --------------------------------------------------- Mot de passe oublié

  /**
   * Demande de réinitialisation.
   *
   * Répond 204 dans tous les cas, y compris pour une adresse inconnue : une
   * réponse différente ferait de ce formulaire public un annuaire des comptes.
   */
  @Public()
  @Post('password/forgot')
  @HttpCode(204)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: RequestWithUser,
  ): Promise<void> {
    await this.account.requestPasswordReset(dto.email, request.ip);
  }

  /**
   * Applique le nouveau mot de passe et **ne connecte pas** l'utilisateur : la
   * réinitialisation ferme toutes les sessions, en ouvrir une aussitôt annulerait
   * la seule protection utile si le compte était détourné. Il se reconnecte.
   */
  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.account.resetPassword(dto.token, dto.password);
    response.clearCookie(
      this.config.get<string>('auth.cookieName', 'bail_session'),
      this.cookieOptions(),
    );
  }

  /**
   * Changement volontaire depuis le compte. Ferme aussi toutes les sessions —
   * y compris celle en cours, d'où le cookie effacé : l'utilisateur se
   * reconnecte avec son nouveau mot de passe.
   */
  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: PublicUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.account.changePassword(user.id, dto.currentPassword, dto.password);
    response.clearCookie(
      this.config.get<string>('auth.cookieName', 'bail_session'),
      this.cookieOptions(),
    );
  }
}
