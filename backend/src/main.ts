import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const prefix = config.get<string>('apiPrefix', 'api/v1');
  app.setGlobalPrefix(prefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: config.get<string[]>('corsOrigins', []),
    credentials: true,
  });

  const port = config.get<number>('port', 4000);
  await app.listen(port);

  Logger.log(
    `Seuil API [${config.get('appEnv')}] écoute sur http://localhost:${port}/${prefix}`,
    'Bootstrap',
  );
}

void bootstrap();
