import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Catch()
@Injectable()
export class IncidentFilter implements ExceptionFilter {
  private readonly logger = new Logger(IncidentFilter.name);
  constructor(private readonly prisma: PrismaService) {}
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    if (status < 500) {
      const body = (error as HttpException).getResponse();
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }
    const requestId = randomUUID();
    // Gabarit Express, jamais URL complète, corps, cookie, identité ou message d’exception.
    const route =
      request.method +
      ' ' +
      (typeof request.route?.path === 'string' ? request.route.path : 'unmatched');
    const category = 'HTTP_' + status;
    const fingerprint = createHash('sha256')
      .update(category + ':' + route)
      .digest('hex');
    this.logger.error(JSON.stringify({ requestId, category, route }));
    void this.prisma.operationalIncident
      .upsert({
        where: { fingerprint },
        create: { fingerprint, requestId, category, route },
        update: {
          requestId,
          count: { increment: 1 },
          lastSeenAt: new Date(),
          acknowledgedAt: null,
        },
      })
      .catch(() =>
        this.logger.error(JSON.stringify({ requestId, category: 'INCIDENT_PERSISTENCE_FAILED' })),
      );
    if (!response.headersSent)
      response
        .status(status)
        .json({
          statusCode: status,
          message: 'Service momentanément indisponible. Réessayez plus tard.',
          requestId,
        });
  }
}
