import { Module } from '@nestjs/common';
import { LeaseController, LeaseSignatureWebhookController } from './lease.controller';
import { LeaseService } from './lease.service';

/**
 * Bail et signature — écran 6.
 *
 * Le driver de signature vient du `SignatureModule`, global comme les autres
 * intégrations.
 */
@Module({
  controllers: [LeaseController, LeaseSignatureWebhookController],
  providers: [LeaseService],
  exports: [LeaseService],
})
export class LeaseModule {}
