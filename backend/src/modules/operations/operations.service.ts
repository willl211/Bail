import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export const RETENTION_DAYS = {
  expiredSessions: 30,
  expiredTokens: 1,
  securityEvents: 90,
  resolvedIncidents: 30,
} as const;
const requestSelect = {
  id: true,
  userId: true,
  status: true,
  reviewNote: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
} as const;

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async requestErasure(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user?.isActive ||
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    )
      throw new UnauthorizedException('Mot de passe incorrect.');
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.erasureRequest.upsert({
        where: { userId },
        update: {},
        create: { userId, fileKeys: [] },
        select: requestSelect,
      });
      await tx.securityEvent.create({
        data: { actorId: userId, subjectId: userId, action: 'ERASURE_REQUESTED' },
      });
      return request;
    });
  }
  mine(userId: string) {
    return this.prisma.erasureRequest.findUnique({ where: { userId }, select: requestSelect });
  }

  async dashboard() {
    const [requests, incidents, securityEvents, failedMail, staleAnalysis] = await Promise.all([
      this.prisma.erasureRequest.findMany({
        where: { status: { not: 'COMPLETED' } },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: requestSelect,
      }),
      this.prisma.operationalIncident.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 50 }),
      this.prisma.securityEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.emailMessage.count({ where: { status: 'FAILED' } }),
      this.prisma.payslipAnalysis.count({
        where: { status: 'PROCESSING', lockedUntil: { lt: new Date() } },
      }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: requests.map((r) => r.userId) } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return {
      requests: requests.map((r) => {
        const user = users.find((u) => u.id === r.userId);
        return {
          ...r,
          accountLabel: user
            ? `${user.firstName} ${user.lastName} · ${user.email}`
            : 'Compte supprimé',
        };
      }),
      incidents,
      securityEvents,
      failedMail,
      staleAnalysis,
      retentionDays: RETENTION_DAYS,
    };
  }
  async acknowledge(fingerprint: string, actorId: string) {
    const updated = await this.prisma.operationalIncident.updateMany({
      where: { fingerprint },
      data: { acknowledgedAt: new Date() },
    });
    if (!updated.count) throw new NotFoundException('Incident introuvable.');
    await this.prisma.securityEvent.create({ data: { actorId, action: 'INCIDENT_ACKNOWLEDGED' } });
  }

  /** Les dossiers engagés exigent une revue de conservation, pas une suppression automatique. */
  private async blockers(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return [];
    const counts = await Promise.all([
      tx.property.count({ where: { ownerId: userId } }),
      tx.application.count({ where: { tenantId: userId } }),
      tx.lease.count({ where: { tenantId: userId } }),
      tx.payment.count({ where: { payerId: userId } }),
      tx.visit.count({ where: { OR: [{ tenantId: userId }, { agentId: userId }] } }),
      tx.subscription.count({ where: { ownerId: userId } }),
    ]);
    return [
      ...(user.role === UserRole.AGENT ? ['Compte interne : traitement manuel requis.'] : []),
      ...counts.flatMap((count, i) =>
        count
          ? [
              ['Biens', 'Candidatures', 'Baux', 'Paiements', 'Visites', 'Abonnements'][i] +
                ' : durée de conservation à examiner.',
            ]
          : [],
      ),
    ];
  }

  async review(id: string, actorId: string, action: 'HOLD' | 'ERASE', note: string) {
    if (!note.trim()) throw new BadRequestException('Indiquez le motif de votre décision.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "erasure_requests" WHERE "id" = ${id} FOR UPDATE`;
      const request = await tx.erasureRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Demande introuvable.');
      await tx.$executeRaw`SELECT "id" FROM "users" WHERE "id" = ${request.userId} FOR UPDATE`;
      if (request.status === 'COMPLETED') return;
      if (request.status === 'ERASING' && action === 'HOLD')
        throw new ConflictException('L’effacement a commencé ; relancez-le pour le terminer.');
      const blockers = await this.blockers(tx, request.userId);
      if (action === 'ERASE' && blockers.length) throw new ConflictException(blockers.join(' '));
      const files =
        action === 'ERASE'
          ? await tx.tenantDocument.findMany({
              where: { tenantFile: { tenantId: request.userId } },
              select: { storageKey: true },
            })
          : [];
      await tx.erasureRequest.update({
        where: { id },
        data: {
          status: action === 'HOLD' ? 'HOLD' : 'ERASING',
          reviewNote: note.trim(),
          reviewedById: actorId,
          ...(action === 'ERASE'
            ? {
                fileKeys: [
                  ...new Set([
                    ...request.fileKeys,
                    ...files.flatMap((f) => (f.storageKey ? [f.storageKey] : [])),
                  ]),
                ],
              }
            : {}),
        },
      });
      if (action === 'ERASE') {
        await tx.user.update({ where: { id: request.userId }, data: { isActive: false } });
        await tx.session.updateMany({
          where: { userId: request.userId },
          data: { revokedAt: new Date() },
        });
        await tx.authToken.deleteMany({ where: { userId: request.userId } });
      }
      await tx.securityEvent.create({
        data: {
          actorId,
          subjectId: request.userId,
          action: action === 'ERASE' ? 'ERASURE_STARTED' : 'ERASURE_HELD',
        },
      });
    });
    if (action === 'ERASE') await this.finishErasure(id);
    return this.prisma.erasureRequest.findUniqueOrThrow({ where: { id }, select: requestSelect });
  }

  async finishErasure(id: string) {
    const request = await this.prisma.erasureRequest.findUniqueOrThrow({ where: { id } });
    if (request.status !== 'ERASING') return;
    for (const key of request.fileKeys) await this.storage.removeRequired('private', key);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "erasure_requests" WHERE "id" = ${id} FOR UPDATE`;
      await tx.$executeRaw`SELECT "id" FROM "users" WHERE "id" = ${request.userId} FOR UPDATE`;
      const current = await tx.erasureRequest.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'ERASING') return;
      const blockers = await this.blockers(tx, request.userId);
      if (blockers.length)
        throw new ConflictException('Le dossier a changé : revue manuelle nécessaire.');
      const files = await tx.tenantDocument.findMany({
        where: { tenantFile: { tenantId: request.userId } },
        select: { storageKey: true },
      });
      if (files.some((f) => f.storageKey && !request.fileKeys.includes(f.storageKey)))
        throw new ConflictException(
          'Une nouvelle pièce a été déposée. Relancez la suppression pour l’inclure.',
        );
      await tx.emailMessage.deleteMany({ where: { recipientId: request.userId } });
      await tx.user.deleteMany({ where: { id: request.userId, isActive: false } });
      if (await tx.user.findUnique({ where: { id: request.userId } }))
        throw new ConflictException('Le compte doit rester désactivé pendant son effacement.');
      await tx.erasureRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          fileKeys: [],
          reviewNote: 'Suppression effectuée pour le compte sans engagement.',
        },
      });
      await tx.securityEvent.create({
        data: {
          actorId: current.reviewedById,
          subjectId: request.userId,
          action: 'ERASURE_COMPLETED',
        },
      });
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'technical-data-retention' })
  async purgeTechnicalData() {
    const before = (days: number) => new Date(Date.now() - days * 86400_000);
    // Pas de purge automatique des baux, paiements ou justificatifs sur une durée supposée.
    return this.prisma.$transaction(async (tx) => {
      const sessions = await tx.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: before(RETENTION_DAYS.expiredSessions) } },
            { revokedAt: { lt: before(RETENTION_DAYS.expiredSessions) } },
          ],
        },
      });
      const tokens = await tx.authToken.deleteMany({
        where: { expiresAt: { lt: before(RETENTION_DAYS.expiredTokens) } },
      });
      const events = await tx.securityEvent.deleteMany({
        where: { createdAt: { lt: before(RETENTION_DAYS.securityEvents) } },
      });
      const incidents = await tx.operationalIncident.deleteMany({
        where: {
          acknowledgedAt: { not: null },
          lastSeenAt: { lt: before(RETENTION_DAYS.resolvedIncidents) },
        },
      });
      const setups = await tx.mfaCredential.deleteMany({
        where: { enabledAt: null, setupExpiresAt: { lt: new Date() } },
      });
      return {
        sessions: sessions.count,
        tokens: tokens.count,
        events: events.count,
        incidents: incidents.count,
        setups: setups.count,
      };
    });
  }
}
