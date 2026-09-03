import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PublicUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/session.guard';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';

/**
 * Candidature à un bien — écran 4 du build-order.
 *
 * Réservé au rôle `TENANT` : un propriétaire qui devinerait l'URL doit se voir
 * refuser l'accès par l'API, pas seulement par la navigation du front.
 */
@Controller('tenant/applications')
@Roles(UserRole.TENANT)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** Suivi de mes candidatures, tous biens confondus. */
  @Get()
  listMine(@CurrentUser() user: PublicUser) {
    return this.applications.listMine(user.id);
  }

  /** Aperçu avant envoi : ce qui part au propriétaire, blocages et avis. */
  @Get(':reference/preview')
  preview(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.applications.preview(user.id, reference);
  }

  @Post(':reference')
  apply(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.applications.apply(user.id, reference, dto);
  }
}
