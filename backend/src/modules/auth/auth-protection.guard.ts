import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { isIP } from 'node:net';
import { AuthRateLimitService, type AuthQuota } from './auth-rate-limit.service';
import type { RequestWithUser } from './session.guard';

type AuthAction =
  'login' | 'register' | 'recovery' | 'verification' | 'credential' | 'token' | 'logout';
const AUTH_ACTION = 'auth:action';
export const AuthThrottle = (action: AuthAction) => SetMetadata(AUTH_ACTION, action);

/** Regroupe les adresses IPv6 d'un même /64 pour éviter la rotation à volonté. */
export function authNetwork(ip: string): string {
  ip = ip.split('%')[0];
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return 'unknown';
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const start = left ? left.split(':') : [];
  const end = right ? right.split(':') : [];
  const words = canonical.includes('::')
    ? [...start, ...Array<string>(8 - start.length - end.length).fill('0'), ...end]
    : start;
  if (words.slice(0, 5).every((word) => word === '0') && words[5] === 'ffff') {
    const high = parseInt(words[6], 16);
    const low = parseInt(words[7], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `${words
    .slice(0, 4)
    .map((word) => parseInt(word, 16).toString(16))
    .join(':')}::/64`;
}

@Injectable()
export class AuthProtectionGuard implements CanActivate {
  private readonly logger = new Logger(AuthProtectionGuard.name);
  private readonly lastWarning = new Map<string, number>();

  constructor(
    private readonly limiter: AuthRateLimitService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET') return true;

    // CORS seul n'empêche pas un navigateur d'envoyer une écriture. Les
    // appels sans Origin restent possibles pour les clients serveur/CLI.
    const origin = request.get('origin');
    if (origin && !this.config.get<string[]>('corsOrigins', []).includes(origin)) {
      throw new ForbiddenException('Origine de la demande non autorisée.');
    }
    if (!origin && request.get('sec-fetch-site') === 'cross-site') {
      throw new ForbiddenException('Origine de la demande non autorisée.');
    }

    const action = this.reflector.get<AuthAction>(AUTH_ACTION, context.getHandler()) ?? 'token';
    // La déconnexion doit rester possible, même après un blocage des tentatives.
    if (action === 'logout') return true;

    const ip = authNetwork(request.ip ?? request.socket.remoteAddress ?? 'unknown');
    const quotas: AuthQuota[] = [
      { scope: 'auth:ip:burst', subject: ip, limit: 20, windowSeconds: 60 },
      { scope: 'auth:ip', subject: ip, limit: 100, windowSeconds: 900 },
      {
        scope: `${action}:ip`,
        subject: ip,
        limit: action === 'login' ? 50 : action === 'register' ? 5 : 20,
        windowSeconds: action === 'register' ? 3600 : 900,
      },
    ];

    // Le guard passe avant les pipes : ne jamais supposer que le corps est
    // valide et appliquer exactement la normalisation du DTO de connexion.
    const body: unknown = request.body;
    const rawEmail = body && typeof body === 'object' && 'email' in body ? body.email : null;
    if ((action === 'login' || action === 'recovery') && typeof rawEmail === 'string') {
      quotas.push({
        scope: `${action}:email`,
        subject: rawEmail.trim().toLowerCase(),
        limit: action === 'login' ? 10 : 3,
        windowSeconds: 900,
      });
    }
    if (request.currentUser && (action === 'credential' || action === 'verification')) {
      quotas.push({
        scope: `${action}:user`,
        subject: request.currentUser.id,
        limit: action === 'credential' ? 5 : 3,
        windowSeconds: 900,
      });
    }

    // Les quotas IP sont consommés d'abord : une origine déjà bloquée ne peut
    // plus créer de compteurs pour une infinité d'adresses e-mail inventées.
    for (const quota of quotas) {
      let retryAfterSeconds: number;
      try {
        retryAfterSeconds = await this.limiter.consume(quota);
      } catch {
        // Une panne du stockage ne désactive jamais la protection.
        this.warn('storage');
        throw new ServiceUnavailableException(
          'Connexion momentanément indisponible. Réessayez plus tard.',
        );
      }
      if (!retryAfterSeconds) continue;
      response.setHeader('Retry-After', retryAfterSeconds.toString());
      // Ni mot de passe, ni jeton, ni adresse e-mail/IP dans les traces.
      this.warn(quota.scope);
      const minutes = Math.ceil(retryAfterSeconds / 60);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'AUTH_RATE_LIMITED',
          message: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private warn(scope: string): void {
    // Nombre de clés borné par les politiques internes, et une trace par
    // minute/politique/processus : un robot ne peut pas saturer les journaux.
    if (Date.now() - (this.lastWarning.get(scope) ?? 0) < 60_000) return;
    this.lastWarning.set(scope, Date.now());
    this.logger.warn(`Protection d'authentification : ${scope}`);
  }
}
