import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { base32, matchingStep, seal, unseal } from './mfa.crypto';
import { hashSecret, newSecret } from './tokens';
import { toPublicUser } from './auth.service';

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    if (
      config.get<string>('appEnv') !== 'development' &&
      !/^[a-f0-9]{64}$/i.test(config.get<string>('auth.mfaEncryptionKey', ''))
    ) {
      throw new Error('MFA_ENCRYPTION_KEY valide requise hors développement.');
    }
  }
  private key(): string {
    const value = this.config.get<string>('auth.mfaEncryptionKey', '');
    if (!/^[a-f0-9]{64}$/i.test(value))
      throw new ServiceUnavailableException(
        'La protection admin doit être configurée sur le serveur.',
      );
    return value;
  }
  async setup(userId: string, password: string, sessionToken: string) {
    const encryptionKey = this.key();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const session = await tx.session.findFirst({
        where: {
          userId,
          tokenHash: hashSecret(sessionToken),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (
        !session ||
        !user.isActive ||
        user.role !== 'AGENT' ||
        !user.passwordHash ||
        !(await bcrypt.compare(password, user.passwordHash))
      ) {
        throw new UnauthorizedException('Mot de passe ou session invalide.');
      }
      const existing = await tx.mfaCredential.findUnique({ where: { userId } });
      if (existing?.enabledAt)
        throw new ConflictException('La double authentification est déjà activée.');
      const secret = base32(randomBytes(20));
      const data = {
        secretEncrypted: seal(secret, encryptionKey, userId),
        setupExpiresAt: new Date(Date.now() + 10 * 60_000),
        recoveryHashes: [] as string[],
        lastUsedStep: BigInt(-1),
      };
      await tx.mfaCredential.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      await tx.securityEvent.create({
        data: { actorId: userId, subjectId: userId, action: 'MFA_SETUP_STARTED' },
      });
      return {
        secret,
        uri: `otpauth://totp/${encodeURIComponent('whoma:' + user.email)}?secret=${secret}&issuer=whoma&algorithm=SHA1&digits=6&period=30`,
      };
    });
  }

  async verify(userId: string, sessionToken: string, code: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const session = await tx.session.findFirst({
        where: {
          userId,
          tokenHash: hashSecret(sessionToken),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      const credential = await tx.mfaCredential.findUnique({ where: { userId } });
      if (!session || !user.isActive || user.role !== 'AGENT')
        throw new UnauthorizedException('Reconnectez-vous avant de saisir un code.');
      if (!credential || (!credential.enabledAt && credential.setupExpiresAt <= new Date()))
        throw new BadRequestException('Recommencez la configuration de votre application.');
      const recovery = credential.enabledAt && credential.recoveryHashes.includes(hashSecret(code));
      const step = recovery
        ? null
        : matchingStep(
            unseal(credential.secretEncrypted, this.key(), userId),
            code,
            credential.lastUsedStep,
          );
      if (!recovery && step === null) {
        await tx.securityEvent.create({
          data: { actorId: userId, subjectId: userId, action: 'MFA_REJECTED' },
        });
        return null;
      }
      const recoveryCodes = credential.enabledAt
        ? []
        : Array.from({ length: 10 }, () => randomBytes(16).toString('base64url'));
      await tx.mfaCredential.update({
        where: { userId },
        data: {
          enabledAt: credential.enabledAt ?? new Date(),
          ...(step === null ? {} : { lastUsedStep: BigInt(step) }),
          recoveryHashes: recoveryCodes.length
            ? recoveryCodes.map(hashSecret)
            : credential.recoveryHashes.filter((hash) => !recovery || hash !== hashSecret(code)),
        },
      });
      // Rotation du secret de session et révocation des sessions antérieures à l’enrôlement.
      await tx.session.updateMany({
        where: { userId, ...(credential.enabledAt ? { id: session.id } : {}) },
        data: { revokedAt: new Date() },
      });
      const token = newSecret();
      const expiresAt = new Date(Date.now() + 8 * 3600_000);
      await tx.session.create({
        data: {
          userId,
          tokenHash: hashSecret(token),
          expiresAt,
          mfaVerifiedAt: new Date(),
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
        },
      });
      await tx.securityEvent.create({
        data: {
          actorId: userId,
          subjectId: userId,
          action: !credential.enabledAt
            ? 'MFA_ENABLED'
            : recovery
              ? 'MFA_RECOVERY_USED'
              : 'MFA_VERIFIED',
        },
      });
      return {
        token,
        expiresAt,
        recoveryCodes,
        user: { ...toPublicUser(user), mfaRequired: false, mfaEnrolled: true },
      };
    });
    if (!result)
      throw new UnauthorizedException(
        'Code invalide ou déjà utilisé. Attendez le prochain code ou utilisez un code de secours.',
      );
    return result;
  }
}
