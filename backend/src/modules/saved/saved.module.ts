import { Module } from '@nestjs/common';
import { SavedController } from './saved.controller';
import { SavedService } from './saved.service';

/**
 * Biens sauvegardés par les locataires.
 *
 * Le service est exporté : l'espace propriétaire et le back-office lisent le
 * décompte par bien sans passer par les routes locataires.
 */
@Module({
  controllers: [SavedController],
  providers: [SavedService],
  exports: [SavedService],
})
export class SavedModule {}
