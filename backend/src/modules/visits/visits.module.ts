import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { SlotsController } from './slots.controller';
import { SlotsService } from './slots.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

/**
 * Visites — écran 5 du build-order.
 *
 * Deux faces du même sujet : le propriétaire ouvre des créneaux sur son bien,
 * le locataire en réserve un. `TenantModule` est importé pour lire le dossier
 * du candidat : c'est lui qui porte la vérification d'identité exigée avant
 * tout rendez-vous.
 */
@Module({
  imports: [TenantModule],
  controllers: [VisitsController, SlotsController],
  providers: [VisitsService, SlotsService],
})
export class VisitsModule {}
