import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    // Conserve la charge brute des requêtes : la signature d'un webhook de
    // paiement se vérifie octet pour octet, et le JSON reparsé puis
    // re-sérialisé par Express ne donne pas la même empreinte.
    rawBody: true,
  });
  const config = app.get(ConfigService);

  const prefix = config.get<string>('apiPrefix', 'api/v1');
  app.setGlobalPrefix(prefix);

  // La session voyage dans un cookie `httpOnly` : le guard doit pouvoir le lire.
  app.use(cookieParser());

  // Derrière le proxy d'OVH, `request.ip` renverrait l'adresse du proxy sans
  // ça — or elle est journalisée avec chaque session, pour l'audit.
  app.set('trust proxy', 1);

  // Fichiers publics (photos d'annonces) uniquement.
  //
  // On sert `storage/public`, JAMAIS `storage/` : la racine privée contient les
  // pièces de dossier locataire — identité, bulletins de salaire — qui ne
  // doivent sortir que par une route contrôlant qui demande quoi. Élargir ce
  // chemin d'un niveau les rendrait téléchargeables par quiconque devine une clé.
  const storageRoot = resolve(config.get<string>('storage.localPath', './storage'), 'public');
  app.useStaticAssets(storageRoot, { prefix: '/uploads/', index: false });

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
    `Bail API [${config.get('appEnv')}] écoute sur http://localhost:${port}/${prefix}`,
    'Bootstrap',
  );
}

void bootstrap();
