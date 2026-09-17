import {
  OpenAIPayslipDriver,
  checkAnalysisFile,
} from '../src/modules/payslip-analysis/payslip.driver';
import {
  AnalysisFailure,
  type PayslipExtraction,
} from '../src/modules/payslip-analysis/payslip.schema';
import type { EvaluationCase } from './corpus';
import {
  estimatedCost,
  grade,
  readUsage,
  type CaseResult,
  type Pricing,
  type Usage,
} from './grader';

interface CampaignOptions {
  apiKey: string;
  model: string;
  pricing: Pricing;
  repetitions: number;
  maxCalls: number;
  budgetUsd: number;
  transport?: typeof fetch;
}
/** Une seule requête en vol ; pas de relance masquée ni de deuxième appel après un coût inconnu. */
export async function runCampaign(
  corpus: EvaluationCase[],
  options: CampaignOptions,
  progress: (
    results: CaseResult[],
    extraction: PayslipExtraction | null,
    stopReason: string | null,
  ) => Promise<void>,
) {
  const { pricing } = options;
  const results: CaseResult[] = [];
  const worstCall =
    (pricing.maxInputTokens *
      Math.max(
        pricing.inputUsdPerMillion,
        pricing.cachedUsdPerMillion,
        pricing.cacheWriteUsdPerMillion ?? 0,
      ) +
      4000 * pricing.outputUsdPerMillion) /
    1_000_000;
  let stopReason: string | null = null;
  outer: for (let repetition = 1; repetition <= options.repetitions; repetition++)
    for (const test of corpus) {
      const spent = results.reduce((n, r) => n + (r.estimatedUsd ?? 0), 0);
      if (results.length >= options.maxCalls || spent + worstCall > options.budgetUsd) {
        stopReason = 'CALL_OR_BUDGET_LIMIT';
        break outer;
      }
      let usage: Usage | null = null;
      const start = Date.now();
      const transport: typeof fetch = async (url, request) => {
        const response = await (options.transport ?? fetch)(url, request);
        if (response.ok) {
          try {
            usage = readUsage(await response.clone().json());
          } catch {
            /* Arrêt avec coût inconnu. */
          }
        }
        return response;
      };
      let error: string | null = null;
      let scored: ReturnType<typeof grade> | null = null;
      let extraction: PayslipExtraction | null = null;
      try {
        const pageCount = await checkAnalysisFile(test.bytes, test.mimeType);
        extraction = await new OpenAIPayslipDriver(
          options.apiKey,
          options.model,
          transport,
        ).analyze({ bytes: test.bytes, mimeType: test.mimeType, pageCount });
        scored = grade(test, extraction);
      } catch (failure) {
        error = failure instanceof AnalysisFailure ? failure.code : 'EVALUATION_FAILED';
      }
      const estimatedUsd = estimatedCost(usage, pricing);
      results.push({
        id: test.id,
        repetition,
        split: test.split,
        sha256: test.sha256,
        durationMs: Date.now() - start,
        usage,
        estimatedUsd,
        error,
        grade: scored,
      });
      if (estimatedUsd === null) stopReason = 'UNKNOWN_COST_STOP';
      await progress([...results], extraction, stopReason);
      if (stopReason) break outer;
    }
  return { results, stopReason };
}
