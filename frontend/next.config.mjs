import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Web responsive uniquement — pas d'app native au MVP (docs/tech-stack.md).
  experimental: {},

  /**
   * Sortie autonome : Next recopie dans `.next/standalone` le serveur et les
   * seules dépendances réellement atteintes. Sans elle, l'image de production
   * devrait embarquer tout le `node_modules` du monorepo — dont le backend,
   * Prisma et l'outillage de test, qui n'ont rien à faire dans le conteneur
   * qui sert les pages.
   */
  output: 'standalone',

  /**
   * La trace part de la racine du monorepo, pas du dossier `frontend` : les
   * dépendances sont remontées à la racine par les workspaces npm, et Next ne
   * les trouverait pas en cherchant sous `frontend/node_modules`.
   */
  outputFileTracingRoot: racine,
};

export default nextConfig;
