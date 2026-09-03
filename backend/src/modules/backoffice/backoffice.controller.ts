import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/session.guard';
import { BackofficeService } from './backoffice.service';
import {
  AssignVisitDto,
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
  ) {
    return this.backoffice.decideDocument(documentId, dto.decision, dto.reason);
  }

  @Post('tenant-files/:reference/decision')
  @HttpCode(200)
  decideFile(@Param('reference') reference: string, @Body() dto: ReviewDecisionDto) {
    return this.backoffice.decideFile(reference, dto.decision, dto.reason);
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
  ) {
    return this.backoffice.decideProperty(reference, dto.decision, dto.reason);
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
