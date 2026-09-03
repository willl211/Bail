import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PublicUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/session.guard';
import { FeesService } from './fees.service';

/**
 * Honoraires locataire — écran 7 du build-order.
 *
 * Réservé au rôle `TENANT` : ce sont ses honoraires, sur son bail.
 */
@Controller('tenant/leases/:reference/fees')
@Roles(UserRole.TENANT)
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  read(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.fees.getFees(reference, user.id);
  }

  /**
   * Ouvre le règlement.
   *
   * Ne prélève rien : renvoie de quoi confirmer le paiement chez le
   * prestataire, qui seul collecte les coordonnées bancaires.
   */
  @Post()
  @HttpCode(200)
  start(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.fees.startPayment(reference, user.id);
  }
}
