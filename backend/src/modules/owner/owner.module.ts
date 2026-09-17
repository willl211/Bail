import { Module } from '@nestjs/common';
import { LeaseModule } from '../lease/lease.module';
import { SavedModule } from '../saved/saved.module';
import { OwnerApplicationsService } from './applications.service';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';
import { PaymentsModule } from '../payments/payments.module';
import { PublicationExpiryService } from './publication-expiry.service';

@Module({
  // `LeaseModule` : accepter un candidat ouvre son bail, et c'est le service
  // de bail qui sait le faire — figer les autres candidatures comprises.
  imports: [LeaseModule, SavedModule, PaymentsModule],
  controllers: [OwnerController],
  providers: [OwnerService, OwnerApplicationsService, PublicationExpiryService],
})
export class OwnerModule {}
