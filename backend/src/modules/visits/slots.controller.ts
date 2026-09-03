import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PublicUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/session.guard';
import { OpenSlotsDto } from './dto/open-slots.dto';
import { SlotsService } from './slots.service';

/**
 * Créneaux de visite ouverts par le propriétaire sur son bien.
 *
 * La maquette annonce des créneaux « ouverts par le propriétaire et l'agent du
 * secteur ». Seul le propriétaire en ouvre pour l'instant : le back-office qui
 * permettrait à un agent d'en ajouter n'existe pas encore, et le modèle
 * (`VisitSlot.openedById`) est prêt à l'accueillir sans changement.
 */
@Controller('owner/properties/:reference/slots')
@Roles(UserRole.OWNER)
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get()
  list(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.slots.list(user.id, reference);
  }

  @Post()
  open(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Body() dto: OpenSlotsDto,
  ) {
    return this.slots.open(user.id, reference, dto);
  }

  @Delete(':slotId')
  close(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Param('slotId') slotId: string,
  ) {
    return this.slots.close(user.id, reference, slotId);
  }
}
