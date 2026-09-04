import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  // Le classement par compatibilité lit le dossier de celui qui regarde. Le
  // module locataire l'expose déjà ; le relire ici dupliquerait la règle qui
  // décide qu'une pièce est vérifiée.
  imports: [TenantModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
