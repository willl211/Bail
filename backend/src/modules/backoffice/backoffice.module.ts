import { Module } from '@nestjs/common';
import { BackofficeController } from './backoffice.controller';
import { BackofficeService } from './backoffice.service';
import { SavedModule } from '../saved/saved.module';

/**
 * Back-office de l'agence.
 *
 * `SubscriptionService` vient du `PaymentsModule`, global : publier une annonce
 * fait entrer le bien dans l'assiette facturée au propriétaire, et c'est lui
 * qui sait la resynchroniser.
 */
@Module({
  imports: [SavedModule],
  controllers: [BackofficeController],
  providers: [BackofficeService],
})
export class BackofficeModule {}
