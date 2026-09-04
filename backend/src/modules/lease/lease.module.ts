import { Module } from '@nestjs/common';
import { LeaseController, LeaseSignatureWebhookController } from './lease.controller';
import { LeaseService } from './lease.service';
import { SavedModule } from '../saved/saved.module';

/**
 * Bail et signature — écran 6.
 *
 * Le driver de signature vient du `SignatureModule`, global comme les autres
 * intégrations.
 */
@Module({
  // L'attribution retire le bien de la diffusion : ceux qui l'avaient mis de
  // côté doivent l'apprendre.
  imports: [SavedModule],
  controllers: [LeaseController, LeaseSignatureWebhookController],
  providers: [LeaseService],
  exports: [LeaseService],
})
export class LeaseModule {}
