import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Stockage de fichiers, derrière un driver — comme les autres intégrations
 * (docs/integrations.md). `local` en développement, S3/OVH en staging et en
 * production, sans changement de code métier.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
