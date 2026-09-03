import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * Candidature à un bien (côté locataire).
 *
 * Importe `TenantModule` pour lire le dossier du candidat — synthèse affichée
 * sur l'écran, identifiant technique pour rattacher la candidature — sans
 * dupliquer la logique d'agrégation des pièces.
 */
@Module({
  imports: [TenantModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
