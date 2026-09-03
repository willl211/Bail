import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { AuthService, PublicUser, SessionResult } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CurrentUser, Public, RequestWithUser } from './session.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
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
}
