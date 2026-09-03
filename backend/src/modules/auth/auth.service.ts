import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hashSecret, newSecret } from './tokens';

/** Profil renvoyé au client. Ne contient jamais le hachage du mot de passe. */
export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone: string | null;
  /**
   * Adresse confirmée. Exposé au front pour qu'il puisse rappeler la
   * confirmation en attente — le contrôle qui compte reste côté API.
   */
  emailVerified: boolean;
  createdAt: string;
}

export interface SessionResult {
  user: PublicUser;
  /** Secret à déposer dans le cookie. Jamais persisté en clair. */
  token: string;
  expiresAt: Date;
}

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Hachage bcrypt d'un mot de passe factice, utilisé pour égaliser le temps de
 * réponse quand l'adresse e-mail n'existe pas. Sans ça, une connexion échoue
 * beaucoup plus vite pour un compte inconnu que pour un mot de passe erroné, et
 * ce simple écart de latence permet d'énumérer les comptes.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.ekhtGWU5wGQeUq0OuHW4iTHRJtHYcqi';

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get ttlMs(): number {
    return this.config.get<number>('auth.sessionTtlDays', 30) * 24 * 60 * 60 * 1000;
  }

  private async createSession(user: User, context: SessionContext): Promise<SessionResult> {
    // Le cookie porte un secret aléatoire ; la base ne garde que son empreinte
    // (voir `tokens.ts`).
    const token = newSecret();
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await this.prisma.session.create({
      data: {
        tokenHash: hashSecret(token),
        userId: user.id,
        expiresAt,
        userAgent: context.userAgent?.slice(0, 500),
        ipAddress: context.ipAddress,
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { user: toPublicUser(user), token, expiresAt };
  }

  async register(dto: RegisterDto, context: SessionContext): Promise<SessionResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      // On indique explicitement que l'adresse est prise. C'est un compromis
      // assumé : ça révèle l'existence d'un compte, mais un message évasif
      // enverrait l'utilisateur créer un doublon qui échouera de toute façon.
      throw new ConflictException('Un compte existe déjà avec cette adresse e-mail.');
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      this.config.get<number>('auth.passwordSaltRounds', 12),
    );

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: dto.role as UserRole,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone || null,
      },
    });

    this.logger.log(`Compte créé (${user.role}) : ${user.id}`);
    return this.createSession(user, context);
  }

  async login(dto: LoginDto, context: SessionContext): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Le hachage est toujours exécuté, même sans compte correspondant : le
    // temps de réponse ne doit pas trahir l'existence de l'adresse.
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException('Adresse e-mail ou mot de passe incorrect.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Ce compte est désactivé.');
    }

    return this.createSession(user, context);
  }

  /**
   * Résout une session à partir du secret du cookie.
   *
   * `lastSeenAt` n'est rafraîchi qu'au-delà d'une heure : sans ce garde-fou,
   * chaque requête authentifiée provoquerait une écriture en base.
   */
  async resolveSession(token: string | undefined): Promise<PublicUser | null> {
    if (!token) return null;

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSecret(token) },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (!session.user.isActive) return null;

    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (session.lastSeenAt < anHourAgo) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    return toPublicUser(session.user);
  }

  /** Révoque la session portée par ce secret. Idempotent. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: hashSecret(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Révoque toutes les sessions actives d'un compte (changement de mot de passe, incident). */
  async revokeAllSessions(userId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /**
   * Comparaison à temps constant, pour les usages où deux secrets applicatifs
   * doivent être confrontés sans fuite de temps.
   */
  static safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
