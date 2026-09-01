import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { DistrictsModule } from './modules/districts/districts.module';
import { MarketModule } from './modules/market/market.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    HealthModule,
    PropertiesModule,
    DistrictsModule,
    MarketModule,
  ],
})
export class AppModule {}
