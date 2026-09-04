import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Application de test.
 *
 * L'application **entière** est démarrée, avec ses guards, ses pipes de
 * validation et son cookie de session — pas un service isolé derrière des
 * doublures. Ce que ces suites vérifient (404 plutôt que 403 sur le bien
 * d'autrui, refus d'une candidature sans adresse confirmée, absorption d'un
 * doublon par un index d'unicité) ne se joue justement pas dans un service pris
 * seul : ça se joue dans la chaîne complète.
 *
 * Les mêmes réglages qu'en production sont appliqués ici — préfixe d'API,
 * `ValidationPipe`, `cookie-parser` — parce qu'un test qui s'en passerait
 * validerait une application qui n'existe nulle part.
 */
export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication(new ExpressAdapter());
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma, close: () => app.close() };
}

/**
 * Vide les tables entre deux cas.
 *
 * `TRUNCATE ... CASCADE` plutôt qu'une cascade de `deleteMany` : l'ordre des
 * suppressions dépendrait alors des clés étrangères, et changerait à chaque
 * évolution du schéma. `RESTART IDENTITY` remet aussi les séquences à zéro, pour
 * que les références générées (`LOC-2026-…`) ne dérivent pas d'un test à l'autre.
 *
 * Les tables sont lues dans le catalogue plutôt qu'énumérées : une table ajoutée
 * au schéma et oubliée ici laisserait fuiter des données d'un test au suivant.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const list = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Extrait le cookie de session d'une réponse, pour rejouer la requête connecté. */
export function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const session = cookies.find((cookie) => cookie.startsWith('bail_session='));
  if (!session) throw new Error('Aucun cookie de session dans la réponse.');
  return session.split(';')[0];
}
