import { Module } from '@nestjs/common';
import { OwnerApplicationsService } from './applications.service';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';

@Module({
  controllers: [OwnerController],
  providers: [OwnerService, OwnerApplicationsService],
})
export class OwnerModule {}
