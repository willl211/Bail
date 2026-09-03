import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthService, PublicUser } from './auth.service';

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES = 'auth:roles';

/** Route accessible sans compte (recherche, fiche annonce, santé). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restreint une route à certains rôles. Implique l'authentification. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** Injecte l'utilisateur résolu par le guard dans un paramètre de contrôleur. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser | null => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.currentUser ?? null;
  },
);

export interface RequestWithUser extends Request {
  currentUser?: PublicUser | null;
  sessionToken?: string;
}

/**
 * Garde d'authentification, appliquée globalement.
 *
 * Le contrôle d'accès vit ici, côté API — pas dans la navigation du front, qui
 * n'en est qu'un reflet (docs/tech-stack.md). Une route non marquée `@Public()`
 * exige une session valide ; `@Roles()` restreint en plus au rôle attendu.
 *
 * Le choix d'un guard global avec dérogation explicite est délibéré : oublier
 * `@Public()` rend une route inaccessible, ce qui se voit tout de suite ;
 * oublier un guard sur une route sensible l'exposerait en silence.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const cookieName = this.config.get<string>('auth.cookieName', 'bail_session');
    const token = (request.cookies as Record<string, string> | undefined)?.[cookieName];
    request.sessionToken = token;

    // La session est toujours résolue, même sur une route publique : l'accueil
    // et la fiche annonce doivent pouvoir adapter leur affichage à un visiteur
    // connecté sans pour autant exiger un compte.
    const user = await this.auth.resolveSession(token);
    request.currentUser = user;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!user) {
      throw new UnauthorizedException('Authentification requise.');
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Votre rôle ne donne pas accès à cette ressource.');
    }

    return true;
  }
}
