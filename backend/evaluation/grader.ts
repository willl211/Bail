import { FIELD_KEYS, type PayslipExtraction } from '../src/modules/payslip-analysis/payslip.schema';
import type { EvaluationCase } from './corpus';

export const normalize = (value: string) =>
  value.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');
export function grade(test: EvaluationCase, actual: PayslipExtraction) {
  const fields = FIELD_KEYS.map((key) => {
    const expected = test.expected[key];
    const found = actual[key];
    const exact =
      typeof expected.value === 'string' && typeof found.value === 'string'
        ? normalize(expected.value) === normalize(found.value)
        : expected.value === found.value;
    const source = found.page === null ? '' : (test.pages[found.page - 1] ?? '');
    const citation =
      found.value === null
        ? found.page === null && found.evidence === null
        : found.evidence !== null &&
          normalize(found.evidence).length > 0 &&
          normalize(source).includes(normalize(found.evidence)) &&
          found.page === expected.page;
    // La citation doit aussi porter la valeur attendue ; citer un titre présent ne suffit pas.
    const displayed =
      typeof expected.value === 'number'
        ? (expected.value / 100).toFixed(2).replace('.', ',')
        : typeof expected.value === 'string' && key.startsWith('period')
          ? expected.value.split('-').reverse().join('/')
          : String(expected.value);
    const quote = normalize(found.evidence ?? '').replace(/\s/g, '');
    const valueQuoted =
      typeof expected.value === 'number'
        ? new RegExp(`(^|[^0-9])${displayed.replace(',', '[,.]')}(?![0-9])`).test(quote)
        : quote.includes(normalize(displayed).replace(/\s/g, ''));
    const support = found.value === null ? citation : exact && citation && valueQuoted;
    return {
      key,
      exact,
      evidence: support,
      hallucinated: expected.value === null && found.value !== null,
      missed: expected.value !== null && found.value === null,
    };
  });
  return {
    kind: actual.kind === test.expected.kind,
    fields,
    missingWarnings: test.expected.warnings.filter((w) => !actual.warnings.includes(w)),
    unexpectedWarnings: actual.warnings.filter((w) => !test.expected.warnings.includes(w)),
    passed:
      actual.kind === test.expected.kind &&
      fields.every((f) => f.exact && f.evidence) &&
      test.expected.warnings.every((w) => actual.warnings.includes(w)),
  };
}

export interface Usage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  model: string | null;
  tier: string | null;
}
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Compteurs absents/incohérents => coût inconnu, jamais artificiellement égal à zéro. */
export function readUsage(payload: unknown): Usage | null {
  const root = obj(payload);
  const usage = obj(root.usage);
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const detail = obj(usage.input_tokens_details);
  const cached = detail.cached_tokens ?? 0;
  const cacheWrite = detail.cache_write_tokens ?? 0;
  const reasoning = obj(usage.output_tokens_details).reasoning_tokens ?? 0;
  if (
    ![input, output, cached, cacheWrite, reasoning].every(
      (n) => Number.isSafeInteger(n) && (n as number) >= 0,
    )
  )
    return null;
  if (
    (cached as number) + (cacheWrite as number) > (input as number) ||
    (reasoning as number) > (output as number)
  )
    return null;
  return {
    input: input as number,
    output: output as number,
    cached: cached as number,
    cacheWrite: cacheWrite as number,
    reasoning: reasoning as number,
    model: typeof root.model === 'string' ? root.model : null,
    tier: typeof root.service_tier === 'string' ? root.service_tier : null,
  };
}
export interface Pricing {
  model: string;
  billedModels: string[];
  checkedAt: string;
  source: string;
  inputUsdPerMillion: number;
  cachedUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheWriteUsdPerMillion?: number;
  maxInputTokens: number;
}
export function validatePricing(value: unknown): Pricing {
  const p = obj(value);
  if (
    typeof p.model !== 'string' ||
    !p.model ||
    !Array.isArray(p.billedModels) ||
    !p.billedModels.length ||
    p.billedModels.some((v) => typeof v !== 'string' || !v) ||
    typeof p.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(p.checkedAt)) ||
    typeof p.source !== 'string' ||
    !['inputUsdPerMillion', 'cachedUsdPerMillion', 'outputUsdPerMillion'].every(
      (k) => typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k] as number) >= 0,
    ) ||
    !Number.isSafeInteger(p.maxInputTokens) ||
    (p.maxInputTokens as number) < 1 ||
    (p.cacheWriteUsdPerMillion !== undefined &&
      (typeof p.cacheWriteUsdPerMillion !== 'number' ||
        !Number.isFinite(p.cacheWriteUsdPerMillion) ||
        p.cacheWriteUsdPerMillion < 0))
  )
    throw new Error('Barème de calcul incomplet ou invalide.');
  return value as Pricing;
}
export function estimatedCost(usage: Usage | null, pricing: Pricing): number | null {
  if (
    !usage ||
    !usage.model ||
    !pricing.billedModels.includes(usage.model) ||
    usage.tier !== 'default' ||
    (usage.cacheWrite > 0 && pricing.cacheWriteUsdPerMillion === undefined)
  )
    return null;
  return (
    ((usage.input - usage.cached - usage.cacheWrite) * pricing.inputUsdPerMillion +
      usage.cached * pricing.cachedUsdPerMillion +
      usage.cacheWrite * (pricing.cacheWriteUsdPerMillion ?? 0) +
      usage.output * pricing.outputUsdPerMillion) /
    1_000_000
  );
}
export interface CaseResult {
  id: string;
  repetition: number;
  split: EvaluationCase['split'];
  sha256: string;
  durationMs: number;
  usage: Usage | null;
  estimatedUsd: number | null;
  error: string | null;
  grade: ReturnType<typeof grade> | null;
}
export function summarize(
  results: CaseResult[],
  expectedCount: number,
  repetitions: number,
  live: boolean,
) {
  const fields = results.flatMap((r) => r.grade?.fields ?? []);
  const money = fields.filter((f) => f.key.endsWith('Cents'));
  const rate = (good: number, count: number) => (count ? good / count : null);
  const metrics = {
    fieldsExact: rate(fields.filter((f) => f.exact).length, fields.length),
    amountsExact: rate(money.filter((f) => f.exact).length, money.length),
    evidenceCorrect: rate(fields.filter((f) => f.evidence).length, fields.length),
    hallucinations: fields.filter((f) => f.hallucinated).length,
    missingValues: fields.filter((f) => f.missed).length,
    wrongKinds: results.filter((r) => r.grade && !r.grade.kind).length,
    missingWarnings: results.reduce((n, r) => n + (r.grade?.missingWarnings.length ?? 0), 0),
    errors: results.filter((r) => r.error).length,
    measuredCostUsd: results.reduce((n, r) => n + (r.estimatedUsd ?? 0), 0),
    unknownCosts: results.filter((r) => r.estimatedUsd === null).length,
  };
  const complete =
    live &&
    repetitions >= 2 &&
    results.length === expectedCount * repetitions &&
    results.every((r) => r.grade !== null) &&
    new Set(results.map((r) => `${r.id}:${r.repetition}`)).size === results.length &&
    new Set(results.map((r) => r.id)).size === expectedCount &&
    results.some((r) => r.split === 'validation');
  const candidate =
    complete &&
    metrics.errors === 0 &&
    metrics.unknownCosts === 0 &&
    metrics.fieldsExact !== null &&
    metrics.fieldsExact >= 0.95 &&
    metrics.amountsExact === 1 &&
    metrics.evidenceCorrect !== null &&
    metrics.evidenceCorrect >= 0.95 &&
    metrics.hallucinations === 0 &&
    metrics.wrongKinds === 0 &&
    metrics.missingWarnings === 0;
  return {
    ...metrics,
    complete,
    recommendation: candidate ? 'HUMAN_REVIEW_REQUIRED' : 'DO_NOT_ACTIVATE',
    note: 'Un corpus synthétique ne valide ni l’authenticité des pièces ni la performance sur tous les formats réels. Aucune activation automatique.',
  };
}
