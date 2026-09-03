import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PublicUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/session.guard';
import { BookVisitDto } from './dto/book-visit.dto';
import { CancelVisitDto } from './dto/cancel-visit.dto';
import { VisitsService } from './visits.service';

/**
 * Prise de rendez-vous de visite — écran 5 du build-order.
 *
 * Réservé au rôle `TENANT`. MVP v0 : visite **accompagnée** ou **visio**
 * uniquement. Le boîtier connecté et la visite autonome sont hors périmètre
 * (CLAUDE.md règle 1) — rien ici ne les prépare.
 */
@Controller('tenant/visits')
@Roles(UserRole.TENANT)
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  /** Tous mes rendez-vous, passés et à venir. */
  @Get()
  listMine(@CurrentUser() user: PublicUser) {
    return this.visits.listMine(user.id);
  }

  /** Écran de réservation pour un bien : créneaux, contrôles, blocages. */
  @Get('property/:reference')
  bookingView(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.visits.bookingView(user.id, reference);
  }

  @Post('property/:reference')
  book(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Body() dto: BookVisitDto,
  ) {
    return this.visits.book(user.id, reference, dto);
  }

  @Delete(':visitId')
  cancel(
    @CurrentUser() user: PublicUser,
    @Param('visitId') visitId: string,
    @Body() dto: CancelVisitDto,
  ) {
    return this.visits.cancel(user.id, visitId, dto.reason);
  }
}
