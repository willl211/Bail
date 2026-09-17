import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { buildCorpus, CORPUS_VERSION } from './corpus';
import { summarize, validatePricing, type CaseResult } from './grader';
import { runCampaign } from './campaign';
import { PAYSLIP_PROMPT_VERSION } from '../src/modules/payslip-analysis/payslip.schema';

const integer = (value: string | undefined, fallback: number, max: number) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('Limite entière invalide.');
  return n;
};

async function main() {
  config({ quiet: true });
  const args = process.argv.slice(2);
  const allowed = [
    '--live',
    '--repetitions',
    '--max-calls',
    '--budget-usd',
    '--pricing',
    '--output',
  ];
  const options = new Map<string, string>();
  let live = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || options.has(key) || (key === '--live' && live))
      throw new Error('Option inconnue ou répétée : ' + key);
    if (key === '--live') {
      live = true;
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Valeur absente pour ' + key);
    options.set(key, value);
  }
  const repetitions = integer(options.get('--repetitions'), 2, 5);
  const maxCalls = integer(options.get('--max-calls'), 28, 70);
  const budget = Number(options.get('--budget-usd') ?? 1);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 25)
    throw new Error('Budget de campagne attendu entre 0 et 25 USD.');
  const pricing = validatePricing(
    JSON.parse(
      await readFile(
        resolve(options.get('--pricing') ?? 'evaluation/pricing.example.json'),
        'utf8',
      ),
    ),
  );
  const model = process.env.DOCUMENT_ANALYSIS_MODEL || pricing.model;
  if (live && (!process.env.OPENAI_API_KEY || model !== pricing.model))
    throw new Error('Mode réel : OPENAI_API_KEY requis et modèle identique au barème de calcul.');
  if (live && Date.now() - Date.parse(pricing.checkedAt) > 30 * 86400_000)
    throw new Error('Revérifiez le barème de calcul : il date de plus de 30 jours.');
  const out = resolve(
    options.get('--output') ?? '.cache/document-evaluation',
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + (live ? 'live' : 'offline'),
  );
  await mkdir(out, { recursive: true });
  const corpus = await buildCorpus();
  const manifest = corpus.map(({ id, split, tags, mimeType, sha256, expected, pages }) => ({
    id,
    split,
    tags,
    mimeType,
    sha256,
    expected,
    pages,
  }));
  for (const test of corpus)
    await writeFile(
      join(
        out,
        test.id +
          (test.mimeType === 'application/pdf'
            ? '.pdf'
            : test.mimeType === 'image/png'
              ? '.png'
              : '.jpg'),
      ),
      test.bytes,
    );
  await writeFile(
    join(out, 'manifest.json'),
    JSON.stringify({ version: CORPUS_VERSION, cases: manifest }, null, 2),
  );
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const driverSha256 = createHash('sha256')
    .update(await readFile(resolve('src/modules/payslip-analysis/payslip.driver.ts')))
    .digest('hex');
  let results: CaseResult[] = [];
  let stopReason: string | null = live ? null : 'OFFLINE_NO_PROVIDER_CALL';
  const report = async () => {
    const summary = summarize(results, corpus.length, repetitions, live);
    await writeFile(
      join(out, 'report.json'),
      JSON.stringify(
        {
          mode: live ? 'live' : 'offline',
          model,
          promptVersion: PAYSLIP_PROMPT_VERSION,
          driverSha256,
          corpusVersion: CORPUS_VERSION,
          corpusSha256: fingerprint,
          repetitions,
          expectedCalls: corpus.length * repetitions,
          maxCalls,
          budgetUsd: budget,
          pricing,
          stopReason,
          summary,
          results,
        },
        null,
        2,
      ),
    );
    const lines = [
      '# Évaluation documentaire',
      '',
      `Mode : ${live ? 'OpenAI — fichiers fictifs uniquement' : 'Hors ligne — aucune mesure de qualité du modèle'}.`,
      '',
      `Modèle demandé : ${model}. Prompt : ${PAYSLIP_PROMPT_VERSION}. Corpus : ${CORPUS_VERSION}.`,
      `Appels réalisés : ${results.length}/${corpus.length * repetitions}. Coût calculable : ${summary.measuredCostUsd.toFixed(6)} USD ; appels au coût inconnu : ${summary.unknownCosts}.`,
      `Recommandation : **${summary.recommendation}**. Arrêt : ${stopReason ?? 'campagne terminée'}.`,
      '',
      summary.note,
      '',
      '| Cas | Répétition | Résultat | Champs erronés | Durée ms | Coût USD |',
      '|---|---:|---|---|---:|---:|',
      ...results.map(
        (r) =>
          `| ${r.id} | ${r.repetition} | ${r.error ?? (r.grade?.passed ? 'conforme au cas fictif' : 'à examiner')} | ${
            r.grade?.fields
              .filter((f) => !f.exact || !f.evidence)
              .map((f) => f.key)
              .join(', ') ?? 'non évalués'
          } | ${r.durationMs} | ${r.estimatedUsd?.toFixed(6) ?? 'inconnu'} |`,
      ),
      '',
      'Les sorties détaillées sont dans le rapport JSON. Relire les documents et citations avant toute activation.',
    ];
    await writeFile(join(out, 'report.md'), lines.join('\n'));
  };
  await report();
  if (!live) {
    console.log(
      `Corpus prêt : ${corpus.length} documents fictifs. Aucun appel OpenAI, aucune activation.\n${out}`,
    );
    return;
  }
  const campaign = await runCampaign(
    corpus,
    {
      apiKey: process.env.OPENAI_API_KEY!,
      model,
      pricing,
      repetitions,
      maxCalls,
      budgetUsd: budget,
    },
    async (current, extraction, reason) => {
      results = current;
      stopReason = reason;
      const last = results[results.length - 1];
      await writeFile(
        join(out, last.id + '-' + last.repetition + '.result.json'),
        JSON.stringify({ extraction, error: last.error }, null, 2),
      );
      console.log(
        last.id +
          ' (' +
          last.repetition +
          '/' +
          repetitions +
          ') : ' +
          (last.error ?? (last.grade?.passed ? 'OK' : 'À examiner')),
      );
      await report();
    },
  );
  results = campaign.results;
  stopReason = campaign.stopReason;
  await report();
  console.log(out);
  if (summarize(results, corpus.length, repetitions, true).recommendation === 'DO_NOT_ACTIVATE')
    process.exitCode = 2;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Évaluation impossible.');
  process.exitCode = 1;
});
