import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PAYSLIP_DRIVER, type PayslipDriver } from '../src/modules/payslip-analysis/payslip.driver';

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

export async function createHarness(
  options: { payslipDriver?: PayslipDriver } = {},
): Promise<Harness> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.payslipDriver)
    builder.overrideProvider(PAYSLIP_DRIVER).useValue(options.payslipDriver);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication(new ExpressAdapter(), {
    // Comme en production : la signature d'un webhook se vérifie octet pour
    // octet, et le JSON reparsé puis re-sérialisé ne redonne pas les mêmes
    // octets. Sans ce réglage, aucun webhook n'était atteignable en test.
    rawBody: true,
  });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  const proxies = app.get(ConfigService).get<string[]>('trustedProxyCidrs', []);
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', proxies.length ? proxies : false);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
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
