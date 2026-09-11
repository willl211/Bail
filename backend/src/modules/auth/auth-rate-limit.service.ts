import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { hashSecret } from './tokens';

export interface AuthQuota {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}

@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Réserve une tentative AVANT bcrypt. L'UPSERT verrouille le compteur en
   * PostgreSQL : requêtes simultanées, processus et redémarrages partagent la
   * même limite. Une requête refusée ne prolonge jamais le délai de blocage.
   * Les adresses e-mail et IP ne sont pas conservées en clair.
   */
  async consume(quota: AuthQuota): Promise<number> {
    const key = hashSecret(JSON.stringify([quota.scope, quota.subject]));
    const [bucket] = await this.prisma.$queryRaw<{ attempts: number; retryAfterSeconds: number }[]>`
      INSERT INTO "auth_rate_limits" ("key", "attempts", "expiresAt")
      VALUES (${key}, 1, CURRENT_TIMESTAMP + ${quota.windowSeconds} * INTERVAL '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE
          WHEN "auth_rate_limits"."expiresAt" <= CURRENT_TIMESTAMP THEN 1
          ELSE LEAST("auth_rate_limits"."attempts" + 1, ${quota.limit + 1})
        END,
        "expiresAt" = CASE
          WHEN "auth_rate_limits"."expiresAt" <= CURRENT_TIMESTAMP
          THEN CURRENT_TIMESTAMP + ${quota.windowSeconds} * INTERVAL '1 second'
          ELSE "auth_rate_limits"."expiresAt"
        END
      RETURNING "attempts",
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - CURRENT_TIMESTAMP))))::integer
          AS "retryAfterSeconds"
    `;

    if (bucket.attempts <= quota.limit) return 0;
    return bucket.retryAfterSeconds;
  }

  /** Purge bornée, sans supprimer les quotas encore actifs. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'auth-rate-limit-purge' })
  async purgeExpired(): Promise<void> {
    const removed = await this.prisma.$executeRaw`
      DELETE FROM "auth_rate_limits"
      WHERE "expiresAt" < CURRENT_TIMESTAMP - INTERVAL '1 hour'
      AND "key" IN (
        SELECT "key" FROM "auth_rate_limits"
        WHERE "expiresAt" < CURRENT_TIMESTAMP - INTERVAL '1 hour'
        ORDER BY "expiresAt" LIMIT 10000
      )
    `;
    if (removed) this.logger.log(`Compteurs d'authentification expirés supprimés : ${removed}`);
  }
}
