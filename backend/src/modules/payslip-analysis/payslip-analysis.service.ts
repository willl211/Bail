import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DocumentType, Prisma, type TenantDocument } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { FILE_CHANGED } from '../tenant/tenant-file.revision';
import {
  PAYSLIP_DRIVER,
  MAX_DOCUMENT_BYTES,
  checkAnalysisFile,
  type PayslipDriver,
} from './payslip.driver';
import { AnalysisFailure, PAYSLIP_PROMPT_VERSION, parsePayslipExtraction } from './payslip.schema';
import { payslipChecks } from './payslip.checks';

const ERRORS: Record<string, string> = {
  NOT_CONFIGURED: 'L’analyse IA n’est pas activée. Le contrôle manuel reste disponible.',
  FILE_UNREADABLE:
    'Le fichier ne peut pas être lu. Consultez l’original ou demandez un nouveau dépôt.',
  FILE_TOO_LARGE:
    'Ce fichier dépasse la limite d’analyse de 8 Mo. Le contrôle manuel reste disponible.',
  PAGE_LIMIT: 'L’analyse accepte un fichier de 1 à 10 pages. Déposez un bulletin par fichier.',
  PROVIDER_UNAVAILABLE: 'Le service d’analyse est momentanément indisponible.',
  PROVIDER_BUSY: 'Le service d’analyse est occupé. Une nouvelle tentative est prévue.',
  PROVIDER_ERROR: 'Le service d’analyse n’a pas pu traiter cette pièce.',
  INVALID_RESULT:
    'La lecture obtenue est inexploitable. Aucune validation automatique n’a été effectuée.',
  INCOMPLETE_RESULT: 'L’analyse n’a pas abouti. La pièce reste à contrôler.',
  PROVIDER_REFUSAL: 'Le service n’a pas fourni de lecture. Consultez la pièce manuellement.',
  INTERRUPTED: 'L’analyse a été interrompue. Vous pouvez la relancer.',
  SOURCE_CHANGED: 'La source a changé. Relancez la lecture du document actuel.',
  DAILY_LIMIT: 'Le quota d’analyse est atteint. Le traitement reprendra automatiquement.',
};

@Injectable()
export class PayslipAnalysisService {
  private readonly logger = new Logger(PayslipAnalysisService.name);
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(PAYSLIP_DRIVER) private readonly driver: PayslipDriver,
    private readonly limits: AuthRateLimitService,
    private readonly config: ConfigService,
  ) {}

  /** Appelé dans la transaction du dépôt : fichier et travail en attente vont ensemble. */
  async enqueue(tx: Prisma.TransactionClient, document: TenantDocument, requestedById: string) {
    if (document.type !== DocumentType.PAYSLIP || !document.storageKey) return;
    await tx.payslipAnalysis.create({
      data: {
        documentId: document.id,
        sourceStorageKey: document.storageKey,
        sourceCreatedAt: document.createdAt,
        requestedById,
        status: this.driver.enabled ? 'QUEUED' : 'UNAVAILABLE',
        provider: this.driver.name,
        model: this.driver.model,
        promptVersion: PAYSLIP_PROMPT_VERSION,
        errorCode: this.driver.enabled ? null : 'NOT_CONFIGURED',
      },
    });
  }

  private async documentForReview(documentId: string, revision: number) {
    const document = await this.prisma.tenantDocument.findUnique({
      where: { id: documentId },
      include: {
        payslipAnalysis: true,
        tenantFile: { include: { tenant: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!document || document.type !== DocumentType.PAYSLIP)
      throw new NotFoundException('Bulletin introuvable.');
    if (document.tenantFile.revision !== revision) throw new ConflictException(FILE_CHANGED);
    if (document.tenantFile.status === 'DRAFT')
      throw new ConflictException('Ce dossier n’a pas encore été transmis.');
    return document;
  }

  async review(documentId: string, revision: number) {
    const document = await this.documentForReview(documentId, revision);
    const analysis = document.payslipAnalysis;
    const sourceMatches =
      !analysis ||
      (analysis.sourceStorageKey === document.storageKey &&
        analysis.sourceCreatedAt.getTime() === document.createdAt.getTime());
    let extraction = null;
    let resultInvalid = false;
    if (analysis?.status === 'COMPLETED' && sourceMatches) {
      try {
        extraction = parsePayslipExtraction(analysis.result);
      } catch {
        resultInvalid = true;
      }
    }
    const others = extraction
      ? await this.prisma.payslipAnalysis.findMany({
          where: {
            status: 'COMPLETED',
            documentId: { not: document.id },
            document: { tenantFileId: document.tenantFileId, type: 'PAYSLIP' },
          },
          include: { document: true },
        })
      : [];
    const otherPeriods = others.flatMap((other) => {
      if (
        other.sourceStorageKey !== other.document.storageKey ||
        other.sourceCreatedAt.getTime() !== other.document.createdAt.getTime()
      )
        return [];
      try {
        const end = parsePayslipExtraction(other.result).periodEnd.value;
        return end ? [end.slice(0, 7)] : [];
      } catch {
        return [];
      }
    });
    const retryAfterSeconds = analysis
      ? Math.max(0, Math.ceil((analysis.requestedAt.getTime() + 60_000 - Date.now()) / 1000))
      : 0;
    const status =
      !sourceMatches || resultInvalid ? 'FAILED' : (analysis?.status ?? 'NOT_REQUESTED');
    const errorCode = !sourceMatches
      ? 'SOURCE_CHANGED'
      : resultInvalid
        ? 'INVALID_RESULT'
        : analysis?.errorCode;
    return {
      documentId,
      revision,
      status,
      configured: this.driver.enabled,
      message:
        !this.driver.enabled && !extraction
          ? ERRORS.NOT_CONFIGURED
          : errorCode
            ? (ERRORS[errorCode] ?? ERRORS.PROVIDER_ERROR)
            : null,
      requestedAt: analysis?.requestedAt.toISOString() ?? null,
      completedAt: analysis?.completedAt?.toISOString() ?? null,
      retryAfterSeconds,
      canRequest:
        this.driver.enabled &&
        !!document.storageKey &&
        ['NOT_REQUESTED', 'UNAVAILABLE', 'FAILED'].includes(status) &&
        retryAfterSeconds === 0,
      extraction,
      checks: extraction
        ? payslipChecks(
            extraction,
            {
              ...document.tenantFile.tenant,
              employerName: document.tenantFile.employerName,
              netMonthlyIncomeCents: document.tenantFile.netMonthlyIncomeCents,
            },
            otherPeriods,
          )
        : [],
    };
  }

  async requestAnalysis(documentId: string, revision: number, actorId: string) {
    const document = await this.documentForReview(documentId, revision);
    if (!this.driver.enabled) throw new ServiceUnavailableException(ERRORS.NOT_CONFIGURED);
    if (!document.storageKey) throw new BadRequestException('Cette pièce n’a pas de fichier.');
    const retryAfter = await this.limits.consume({
      scope: 'payslip:manual:agent',
      subject: actorId,
      limit: 30,
      windowSeconds: 3600,
    });
    if (retryAfter)
      throw new HttpException('Trop de demandes d’analyse. Réessayez plus tard.', 429);
    await this.prisma.$transaction(async (tx) => {
      // Même ordre de verrouillage que le retrait et la décision : dossier puis pièce.
      const rows = await tx.$queryRaw<
        { revision: number }[]
      >`SELECT "revision" FROM "tenant_files" WHERE "id" = ${document.tenantFileId} FOR UPDATE`;
      if (rows[0]?.revision !== revision) throw new ConflictException(FILE_CHANGED);
      const current = await tx.tenantDocument.findUnique({
        where: { id: documentId },
        include: { payslipAnalysis: true },
      });
      if (!current || current.storageKey !== document.storageKey)
        throw new ConflictException(FILE_CHANGED);
      const previous = current.payslipAnalysis;
      let completedResultValid = false;
      if (previous?.status === 'COMPLETED') {
        try {
          parsePayslipExtraction(previous.result);
          completedResultValid = true;
        } catch {
          // Un résultat devenu inexploitable doit pouvoir être relancé.
        }
      }
      if (
        previous &&
        (['QUEUED', 'PROCESSING'].includes(previous.status) || completedResultValid) &&
        previous.sourceStorageKey === current.storageKey &&
        previous.sourceCreatedAt.getTime() === current.createdAt.getTime()
      )
        return;
      if (previous && Date.now() - previous.requestedAt.getTime() < 60_000)
        throw new HttpException('Attendez une minute avant de relancer cette analyse.', 429);
      const data = {
        status: 'QUEUED' as const,
        sourceStorageKey: current.storageKey!,
        sourceCreatedAt: current.createdAt,
        provider: this.driver.name,
        model: this.driver.model,
        promptVersion: PAYSLIP_PROMPT_VERSION,
        requestedById: actorId,
        requestedAt: new Date(),
        nextAttemptAt: new Date(),
        attempts: 0,
        result: Prisma.DbNull,
        errorCode: null,
        completedAt: null,
        sourceSha256: null,
        runToken: null,
        lockedUntil: null,
      };
      await tx.payslipAnalysis.upsert({
        where: { documentId },
        create: { documentId, ...data },
        update: { ...data, generation: { increment: 1 } },
      });
    });
    this.logger.log(`Analyse de bulletin demandée : ${documentId}, agent ${actorId}`);
    return this.review(documentId, revision);
  }

  @Interval(15_000)
  async tick(): Promise<void> {
    if (
      this.running ||
      !this.driver.enabled ||
      !this.config.get<boolean>('documentAnalysis.workerEnabled', true)
    )
      return;
    this.running = true;
    try {
      await this.processNext();
    } catch {
      this.logger.error('Traitement de bulletin interrompu ; reprise prévue.');
    } finally {
      this.running = false;
    }
  }

  async processNext(): Promise<boolean> {
    if (!this.driver.enabled) return false;
    const now = new Date();
    await this.prisma.payslipAnalysis.updateMany({
      where: { status: 'PROCESSING', lockedUntil: { lt: now }, attempts: { gte: 3 } },
      data: { status: 'FAILED', errorCode: 'INTERRUPTED', runToken: null, lockedUntil: null },
    });
    const candidate = await this.prisma.payslipAnalysis.findFirst({
      where: {
        attempts: { lt: 3 },
        OR: [
          { status: 'QUEUED', nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', lockedUntil: { lt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return false;
    const runToken = randomUUID();
    const claim = await this.prisma.payslipAnalysis.updateMany({
      where: { id: candidate.id, generation: candidate.generation, updatedAt: candidate.updatedAt },
      data: {
        status: 'PROCESSING',
        runToken,
        lockedUntil: new Date(Date.now() + 180_000),
        attempts: { increment: 1 },
        errorCode: null,
        provider: this.driver.name,
        model: this.driver.model,
        promptVersion: PAYSLIP_PROMPT_VERSION,
      },
    });
    if (claim.count !== 1) return false;
    const ownership = {
      id: candidate.id,
      generation: candidate.generation,
      runToken,
      status: 'PROCESSING' as const,
    };
    try {
      const document = await this.prisma.tenantDocument.findUnique({
        where: { id: candidate.documentId },
        include: { tenantFile: true },
      });
      if (
        !document ||
        document.type !== 'PAYSLIP' ||
        document.storageKey !== candidate.sourceStorageKey ||
        document.createdAt.getTime() !== candidate.sourceCreatedAt.getTime()
      )
        throw new AnalysisFailure('SOURCE_CHANGED');
      const stream = await this.storage.read('private', candidate.sourceStorageKey);
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => stream.destroy(new Error('Read timeout')), 20_000);
      try {
        for await (const chunk of stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          size += bytes.length;
          if (size > MAX_DOCUMENT_BYTES) throw new AnalysisFailure('FILE_TOO_LARGE');
          chunks.push(bytes);
        }
      } finally {
        clearTimeout(timer);
        stream.destroy();
      }
      const bytes = Buffer.concat(chunks);
      const pageCount = await checkAnalysisFile(bytes, document.mimeType ?? '');
      // Le retrait peut se produire pendant la lecture du fichier.
      if (!(await this.prisma.payslipAnalysis.findFirst({ where: ownership }))) return true;
      for (const quota of [
        {
          scope: 'payslip:provider:tenant',
          subject: document.tenantFile.tenantId,
          limit: 10,
          windowSeconds: 86400,
        },
        { scope: 'payslip:provider:global', subject: 'platform', limit: 50, windowSeconds: 86400 },
      ]) {
        const wait = await this.limits.consume(quota);
        if (wait) {
          await this.prisma.payslipAnalysis.updateMany({
            where: ownership,
            data: {
              status: 'QUEUED',
              attempts: { decrement: 1 },
              errorCode: 'DAILY_LIMIT',
              nextAttemptAt: new Date(Date.now() + wait * 1000),
              lockedUntil: null,
              runToken: null,
            },
          });
          return true;
        }
      }
      const result = parsePayslipExtraction(
        await this.driver.analyze({ bytes, mimeType: document.mimeType!, pageCount }),
        pageCount,
      );
      // Aucune écriture sur TenantDocument/TenantFile : l'IA ne peut ni valider,
      // ni écraser une décision humaine, ni remplacer un revenu déclaré.
      await this.prisma.payslipAnalysis.updateMany({
        where: {
          ...ownership,
          document: {
            storageKey: candidate.sourceStorageKey,
            createdAt: candidate.sourceCreatedAt,
          },
        },
        data: {
          status: 'COMPLETED',
          result: result as unknown as Prisma.InputJsonValue,
          sourceSha256: createHash('sha256').update(bytes).digest('hex'),
          completedAt: new Date(),
          lockedUntil: null,
          runToken: null,
          errorCode: null,
        },
      });
    } catch (error) {
      const issue =
        error instanceof AnalysisFailure
          ? error
          : new AnalysisFailure('PROVIDER_UNAVAILABLE', true);
      const retry = issue.retryable && candidate.attempts + 1 < 3;
      await this.prisma.payslipAnalysis.updateMany({
        where: ownership,
        data: {
          status: retry ? 'QUEUED' : 'FAILED',
          errorCode: issue.code,
          nextAttemptAt: new Date(Date.now() + 30_000 * (candidate.attempts + 1)),
          lockedUntil: null,
          runToken: null,
        },
      });
      this.logger.warn(`Analyse ${candidate.id} : ${issue.code}`);
    }
    return true;
  }
}
