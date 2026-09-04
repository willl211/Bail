import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Prépare la base de test, une fois avant toute la campagne d'intégration.
 *
 * Une base **distincte** de celle de développement, et non un schéma partagé :
 * les tests vident des tables entre chaque cas, et se tromper de cible
 * effacerait le jeu de démonstration sur lequel on travaille. Le nom porte le
 * suffixe `_test` et la garde ci-dessous refuse de tourner sur autre chose.
 */
const TEST_DATABASE = 'bail_test';

function adminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

export function testDatabaseUrl(): string {
  const source =
    process.env.DATABASE_URL ??
    'postgresql://bail:bail@localhost:5433/bail_dev?schema=public';
  const url = new URL(source);
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
}

export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();

  // Garde-fou : mieux vaut une campagne qui refuse de démarrer qu'une campagne
  // qui vide la base de développement.
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(`Base de test attendue en « _test », reçu : ${url}`);
  }

  const admin = new Client({ connectionString: adminUrl(url) });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      'PostgreSQL est injoignable. Lancez `npm run db:up` avant les tests d’intégration.\n' +
        `Détail : ${(error as Error).message}`,
    );
  }

  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    TEST_DATABASE,
  ]);
  if (rowCount === 0) {
    // `pg_database` n'accepte pas de paramètre lié sur le nom : la constante est
    // définie ici, elle ne vient d'aucune entrée extérieure.
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  }
  await admin.end();

  // Les migrations, pas `db push` : la base de test doit être exactement celle
  // que produiront les migrations en production. Une divergence de schéma qui
  // n'apparaîtrait qu'au déploiement ne serait découverte que là.
  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = url;
}
