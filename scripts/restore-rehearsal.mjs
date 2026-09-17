/** Recette locale sur deux bases neuves fictives. Ne lit ni n’efface bail_dev/bail_test. */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'backend/package.json'));
const { PrismaClient } = require('@prisma/client');
const suffix = randomBytes(6).toString('hex');
const source = `whoma_restore_${suffix}_source`;
const target = `whoma_restore_${suffix}_target`;
const databases = [source, target];
if (!databases.every(name => /^whoma_restore_[a-f0-9]{12}_(source|target)$/.test(name))) throw new Error('Cible de recette invalide');
const out = join(root, '.cache', 'restore-rehearsal', suffix);
mkdirSync(out, { recursive: true });
const docker = (...args) => execFileSync('docker', ['exec', '-i', 'bail-postgres', ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const url = name => `postgresql://bail:bail@127.0.0.1:5433/${name}?schema=public`;
const created = [];
let original, restored;
const start = Date.now();
try {
  for (const name of databases) { docker('createdb', '-U', 'bail', name); created.push(name); }
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: join(root, 'backend'), env: { ...process.env, DATABASE_URL: url(source) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  original = new PrismaClient({ datasources: { db: { url: url(source) } } });
  restored = new PrismaClient({ datasources: { db: { url: url(target) } } });
  const user = await original.user.create({ data: { email: 'fictional@restore.invalid', role: 'TENANT', firstName: 'Spécimen', lastName: 'Restauration' } });
  const file = await original.tenantFile.create({ data: { tenantId: user.id, reference: 'RESTORE-FICTIF' } });
  await original.tenantDocument.create({ data: { tenantFileId: file.id, type: 'OTHER', storageKey: 'specimen.txt' } });
  await original.securityEvent.create({ data: { subjectId: user.id, action: 'RESTORE_TEST_FIXTURE' } });
  const payload = Buffer.from('SPECIMEN FICTIF — restauration whoma, aucune donnée réelle.');
  writeFileSync(join(out, 'specimen-source.txt'), payload);
  const dump = docker('pg_dump', '-U', 'bail', '-Fc', '--no-owner', '--no-acl', source);
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(dump), cipher.final()]);
  writeFileSync(join(out, 'database.dump.enc'), Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
  // Clé locale fictive uniquement : en exploitation, clé et archives sont conservées séparément.
  writeFileSync(join(out, 'fixture-key.hex'), key.toString('hex'), { mode: 0o600 });
  copyFileSync(join(out, 'specimen-source.txt'), join(out, 'specimen-backup.txt'));
  const archive = readFileSync(join(out, 'database.dump.enc'));
  const decipher = createDecipheriv('aes-256-gcm', key, archive.subarray(0, 12));
  decipher.setAuthTag(archive.subarray(12, 28));
  const clear = Buffer.concat([decipher.update(archive.subarray(28)), decipher.final()]);
  execFileSync('docker', ['exec', '-i', 'bail-postgres', 'pg_restore', '-U', 'bail', '--no-owner', '--no-acl', '--single-transaction', '-d', target], {
    input: clear, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  copyFileSync(join(out, 'specimen-backup.txt'), join(out, 'specimen-restored.txt'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const tables = await original.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const counts = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Nom de table inattendu');
    const query = `SELECT count(*)::int AS n FROM "${tablename}"`;
    const [a] = await original.$queryRawUnsafe(query), [b] = await restored.$queryRawUnsafe(query);
    if (a.n !== b.n) throw new Error('Comptages restaurés incohérents');
    counts[tablename] = b.n;
  }
  const restoredUser = await restored.user.findUniqueOrThrow({ where: { id: user.id }, include: { tenantFile: { include: { documents: true } } } });
  if (restoredUser.firstName !== user.firstName || restoredUser.tenantFile?.documents[0]?.storageKey !== 'specimen.txt') throw new Error('Relations restaurées incorrectes');
  if (hash(payload) !== hash(readFileSync(join(out, 'specimen-restored.txt')))) throw new Error('Fichier restauré incorrect');
  writeFileSync(join(out, 'report.json'), JSON.stringify({ status: 'PASSED', at: new Date().toISOString(), durationMs: Date.now() - start, source, target, tableCounts: counts, archiveSha256: hash(archive), storageSha256: hash(payload), limitations: 'Données fictives, sauvegarde locale. Ne valide pas les sauvegardes OVH, S3, la planification ni les objectifs de reprise en production.' }, null, 2));
  console.log('Restauration fictive validée. Rapport : ' + join(out, 'report.json'));
} catch {
  console.error('Recette de restauration interrompue. Vérifier Docker et les rapports locaux ; aucune base applicative n’a été ciblée.');
  process.exitCode = 1;
} finally {
  await original?.$disconnect(); await restored?.$disconnect();
  for (const name of created.reverse()) {
    try { docker('dropdb', '-U', 'bail', name); }
    catch { console.error('Base fictive à nettoyer : ' + name); process.exitCode = 1; }
  }
}
