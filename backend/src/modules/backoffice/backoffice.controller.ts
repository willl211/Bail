import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/session.guard';
import type { PublicUser } from '../auth/auth.service';
import { BackofficeService } from './backoffice.service';
import {
  AssignVisitDto,
  DiagnosticDecisionDto,
  PropertyDecisionDto,
  ReviewDecisionDto,
} from './dto/decision.dto';

/**
 * Back-office — registre de l'agence.
 *
 * Réservé au rôle `AGENT`, qui couvre l'agent de terrain et l'administrateur
 * (README, règle 9). C'est ici que se prennent les décisions qui débloquent les
 * parcours : mettre une annonce en ligne, trancher sur une pièce en revue
 * humaine, affecter un agent à une visite.
 */
@Controller('admin')
@Roles(UserRole.AGENT)
export class BackofficeController {
  constructor(private readonly backoffice: BackofficeService) {}

  @Get('summary')
  summary() {
    return this.backoffice.summary();
  }

  @Get('providers')
  providers() {
    return this.backoffice.providers();
  }

  @Get('journal')
  journal() {
    return this.backoffice.journal();
  }

  // --- Dossiers ---------------------------------------------------------

  @Get('tenant-files')
  files() {
    return this.backoffice.listFiles();
  }

  @Post('documents/:documentId/decision')
  @HttpCode(200)
  decideDocument(
    @Param('documentId') documentId: string,
    @Body() dto: ReviewDecisionDto,
    @CurrentUser() user: PublicUser,
  ) {
    return this.backoffice.decideDocument(
      documentId,
      dto.decision,
      dto.expectedRevision,
      { id: user.id, label: `${user.firstName} ${user.lastName}` },
      dto.reason,
    );
  }

  @Get('documents/:documentId/file')
  async readDocument(
    @Param('documentId') documentId: string,
    @CurrentUser() user: PublicUser,
    @Res({ passthrough: true }) response: Response,
    @Query('revision', new ParseIntPipe({ optional: true })) revision?: number,
  ) {
    const document = await this.backoffice.readTenantDocument(
      documentId,
      {
        id: user.id,
        label: `${user.firstName} ${user.lastName}`,
      },
      revision,
    );
    response.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.fileName)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(document.stream);
  }

  @Post('tenant-files/:reference/decision')
  @HttpCode(200)
  decideFile(
    @Param('reference') reference: string,
    @Body() dto: ReviewDecisionDto,
    @CurrentUser() user: PublicUser,
  ) {
    return this.backoffice.decideFile(
      reference,
      dto.decision,
      dto.expectedRevision,
      { id: user.id, label: `${user.firstName} ${user.lastName}` },
      dto.reason,
    );
  }

  // --- Biens ------------------------------------------------------------

  @Get('properties')
  properties() {
    return this.backoffice.listProperties();
  }

  @Post('properties/:reference/decision')
  @HttpCode(200)
  decideProperty(
    @Param('reference') reference: string,
    @Body() dto: PropertyDecisionDto,
    @CurrentUser() user: PublicUser,
  ) {
    return this.backoffice.decideProperty(
      reference,
      dto.decision,
      dto.expectedRevision,
      { id: user.id, label: `${user.firstName} ${user.lastName}` },
      dto.reason,
    );
  }

  @Get('property-documents/:documentId/file')
  async readPropertyDocument(
    @Param('documentId') documentId: string,
    @CurrentUser() user: PublicUser,
    @Res({ passthrough: true }) response: Response,
    @Query('revision', new ParseIntPipe({ optional: true })) revision?: number,
  ) {
    const document = await this.backoffice.readPropertyDocument(
      documentId,
      {
        id: user.id,
        label: `${user.firstName} ${user.lastName}`,
      },
      revision,
    );
    response.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.fileName)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(document.stream);
  }

  @Post('property-documents/:documentId/decision')
  @HttpCode(200)
  decidePropertyDocument(
    @Param('documentId') documentId: string,
    @Body() dto: DiagnosticDecisionDto,
    @CurrentUser() user: PublicUser,
  ) {
    return this.backoffice.decidePropertyDocument(documentId, dto, {
      id: user.id,
      label: `${user.firstName} ${user.lastName}`,
    });
  }

  // --- Baux et visites ---------------------------------------------------

  @Get('leases')
  leases() {
    return this.backoffice.listLeases();
  }

  @Get('visits')
  visits() {
    return this.backoffice.listVisits();
  }

  @Get('agents')
  agents() {
    return this.backoffice.agents();
  }

  @Post('visits/:visitId/assign')
  @HttpCode(200)
  assignVisit(@Param('visitId') visitId: string, @Body() dto: AssignVisitDto) {
    return this.backoffice.assignVisit(visitId, dto.agentId);
  }
}
