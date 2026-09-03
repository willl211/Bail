import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { DistrictsModule } from './modules/districts/districts.module';
import { MarketModule } from './modules/market/market.module';
import { AuthModule } from './modules/auth/auth.module';
import { OwnerModule } from './modules/owner/owner.module';
import { StorageModule } from './modules/storage/storage.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { VerificationModule } from './modules/verification/verification.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { VideoModule } from './modules/video/video.module';
import { VisitsModule } from './modules/visits/visits.module';
import { SignatureModule } from './modules/signature/signature.module';
import { LeaseModule } from './modules/lease/lease.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    // AuthModule enregistre le guard global : toute route est privée par défaut
    // et doit être marquée `@Public()` pour ne pas l'être.
    AuthModule,
    StorageModule,
    HealthModule,
    PropertiesModule,
    DistrictsModule,
    MarketModule,
    OwnerModule,
    PaymentsModule,
    VerificationModule,
    TenantModule,
    ApplicationsModule,
    VideoModule,
    VisitsModule,
    SignatureModule,
    LeaseModule,
  ],
})
export class AppModule {}
