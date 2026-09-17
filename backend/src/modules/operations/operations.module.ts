import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { OperationsService } from './operations.service';
import { OperationsController, PrivacyController } from './operations.controller';
import { IncidentFilter } from './incident.filter';

@Module({
  controllers: [OperationsController, PrivacyController],
  providers: [OperationsService, { provide: APP_FILTER, useClass: IncidentFilter }],
  exports: [OperationsService],
})
export class OperationsModule {}
