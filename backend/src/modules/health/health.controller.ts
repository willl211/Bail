import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/session.guard';

/** Sonde de supervision : doit répondre sans session. */
@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async check() {
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      environment: this.config.get('appEnv'),
      database,
      integrations: {
        kyc: this.config.get('integrations.kyc.driver'),
        signature: this.config.get('integrations.signature.driver'),
        payment: this.config.get('integrations.payment.driver'),
        video: this.config.get('integrations.video.driver'),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
