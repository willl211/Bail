import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/session.guard';
import type { PublicUser } from '../auth/auth.service';
import { SubscriptionService } from './subscription.service';

/**
 * Abonnement propriétaire — écran 6 de la maquette.
 *
 * Réservé au rôle `OWNER` : un locataire qui devinerait l'URL doit se voir
 * refuser l'accès par l'API, pas seulement par la navigation du front.
 */
@Controller('owner/subscription')
@Roles(UserRole.OWNER)
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get()
  overview(@CurrentUser() user: PublicUser) {
    return this.subscriptions.getOverview(user.id);
  }

  @Post()
  subscribe(@CurrentUser() user: PublicUser) {
    return this.subscriptions.subscribe(user.id);
  }

  /** Résilie à la fin de la période en cours. */
  @Delete()
  cancel(@CurrentUser() user: PublicUser) {
    return this.subscriptions.cancel(user.id);
  }

  /** Revient sur une résiliation tant qu'elle n'a pas pris effet. */
  @Post('resume')
  @HttpCode(200)
  resume(@CurrentUser() user: PublicUser) {
    return this.subscriptions.resume(user.id);
  }
}
