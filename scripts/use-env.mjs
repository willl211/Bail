#!/usr/bin/env node
/**
 * Répartit env/<environnement>.env.example vers backend/.env et frontend/.env.local.
 *
 *   npm run env:use development
 *
 * Les variables NEXT_PUBLIC_* et API_INTERNAL_URL vont au frontend, tout le
 * reste au backend. Le fichier source reste un *example* : après copie, il faut
 * remplacer les __A_RENSEIGNER__ par les vraies valeurs (hors repo).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? 'development';
const allowed = ['development', 'staging', 'production'];

if (!allowed.includes(target)) {
  console.error(`Environnement inconnu : "${target}". Attendu : ${allowed.join(' | ')}`);
  process.exit(1);
}

const source = resolve(root, 'env', `${target}.env.example`);
if (!existsSync(source)) {
  console.error(`Fichier introuvable : ${source}`);
  process.exit(1);
}

const lines = readFileSync(source, 'utf8').split(/\r?\n/);
const isFrontend = (key) => key.startsWith('NEXT_PUBLIC_') || key === 'API_INTERNAL_URL';

const backend = [];
const frontend = [];
for (const line of lines) {
  const match = /^([A-Z0-9_]+)=/.exec(line.trim());
  if (!match) continue;
  (isFrontend(match[1]) ? frontend : backend).push(line);
}

const header = (name) =>
  `# Généré depuis env/${target}.env.example par \`npm run env:use ${target}\`.\n` +
  `# Fichier ignoré par git — remplacer les valeurs __A_RENSEIGNER__ avant usage.\n` +
  `# Cible : ${name}\n\n`;

writeFileSync(resolve(root, 'backend/.env'), header('backend') + backend.join('\n') + '\n');
writeFileSync(resolve(root, 'frontend/.env.local'), header('frontend') + frontend.join('\n') + '\n');

console.log(`Environnement "${target}" appliqué :`);
console.log(`  backend/.env        (${backend.length} variables)`);
console.log(`  frontend/.env.local (${frontend.length} variables)`);
