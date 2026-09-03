import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController],
  providers: [TenantService],
  // Le module `applications` a besoin du dossier du locataire (synthèse
  // affichée sur l'écran de candidature, identifiant technique pour la
  // création de la candidature) : il importe ce module pour y accéder,
  // plutôt que de dupliquer la lecture du dossier.
  exports: [TenantService],
})
export class TenantModule {}
