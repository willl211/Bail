import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Configuration de la CLI Prisma.
 *
 * Remplace le bloc `prisma` du `package.json`, déprécié et retiré en Prisma 7.
 * Aucun réglage n'a changé au passage : même schéma, même commande de seed.
 *
 * `dotenv/config` est importé explicitement. Le bloc `package.json` bénéficiait
 * du chargement automatique du `.env` par la CLI ; un fichier de configuration,
 * lui, est évalué avant, et sans cette ligne `DATABASE_URL` serait absente au
 * moment où la CLI en a besoin.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
