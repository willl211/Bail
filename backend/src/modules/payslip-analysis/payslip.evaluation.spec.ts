import { buildCorpus, type EvaluationCase } from '../../../evaluation/corpus';
import {
  grade,
  readUsage,
  estimatedCost,
  summarize,
  validatePricing,
  type Pricing,
  type CaseResult,
} from '../../../evaluation/grader';
import { checkAnalysisFile } from './payslip.driver';
import { parsePayslipExtraction } from './payslip.schema';
import { runCampaign } from '../../../evaluation/campaign';

const pricing: Pricing = {
  model: 'test',
  billedModels: ['test-snapshot'],
  checkedAt: '2026-09-15',
  source: 'https://developers.openai.com',
  inputUsdPerMillion: 1,
  cachedUsdPerMillion: 0.1,
  outputUsdPerMillion: 4,
  maxInputTokens: 400000,
};
describe('Évaluation documentaire — corpus et mesures', () => {
  let corpus: EvaluationCase[];
  beforeAll(async () => {
    corpus = await buildCorpus();
  });
  const standard = () => corpus.find((c) => c.id === 'standard')!;
  it('génère 14 documents fictifs lisibles par le circuit produit, avec vérité de référence valide', async () => {
    expect(corpus).toHaveLength(14);
    expect(new Set(corpus.map((c) => c.id)).size).toBe(14);
    expect(corpus.filter((c) => c.split === 'validation')).toHaveLength(4);
    for (const test of corpus) {
      const pages = await checkAnalysisFile(test.bytes, test.mimeType);
      expect(parsePayslipExtraction(test.expected, pages)).toEqual(test.expected);
      expect(grade(test, test.expected).passed).toBe(true);
      expect(test.pages.every((page) => page.includes('SPECIMEN FICTIF'))).toBe(true);
    }
  });
  it('reproduit les mêmes fichiers et empreintes sur la même machine', async () => {
    const second = await buildCorpus();
    expect(second.map((c) => c.sha256)).toEqual(corpus.map((c) => c.sha256));
  });
  it('détecte la confusion net payé/net avant impôt même avec une citation réellement présente', () => {
    const actual = structuredClone(standard().expected);
    actual.netBeforeTaxCents = actual.netPaidCents;
    expect(
      grade(standard(), actual).fields.find((f) => f.key === 'netBeforeTaxCents'),
    ).toMatchObject({ exact: false, evidence: false });
  });
  it('ne crédite pas une abstention systématique et détecte les valeurs inventées', () => {
    const actual = structuredClone(standard().expected);
    actual.employeeName = { value: null, page: null, evidence: null };
    expect(grade(standard(), actual).fields[0]).toMatchObject({ exact: false, missed: true });
    const missing = corpus.find((c) => c.id === 'missing-before-tax')!;
    expect(
      grade(missing, standard().expected).fields.find((f) => f.key === 'netBeforeTaxCents')
        ?.hallucinated,
    ).toBe(true);
  });
  it('refuse une citation inventée, générique ou citée sur la mauvaise page', () => {
    for (const evidence of ['valeur non présente dans la pièce', 'BULLETIN DE SALAIRE', 'Net']) {
      const actual = structuredClone(standard().expected);
      actual.netBeforeTaxCents.evidence = evidence;
      expect(
        grade(standard(), actual).fields.find((f) => f.key === 'netBeforeTaxCents')?.evidence,
      ).toBe(false);
    }
    const actual = structuredClone(standard().expected);
    actual.netBeforeTaxCents.page = 2;
    expect(
      grade(standard(), actual).fields.find((f) => f.key === 'netBeforeTaxCents')?.evidence,
    ).toBe(false);
  });
  it('distingue zéro d’une valeur absente et ne valide pas zéro avec la citation de 3500 euros', () => {
    const test = corpus.find((c) => c.id === 'validation-zero')!;
    const actual = structuredClone(test.expected);
    actual.netPaidCents.evidence = 'Salaire brut indicatif : 3 500,00 EUR';
    expect(grade(test, actual).fields.find((f) => f.key === 'netPaidCents')?.evidence).toBe(false);
    actual.netPaidCents = { value: null, evidence: null, page: null };
    expect(grade(test, actual).passed).toBe(false);
  });
  it('exige le signalement des instructions et des bulletins multiples', () => {
    for (const id of ['instructions', 'two-payslips']) {
      const test = corpus.find((c) => c.id === id)!;
      const actual = structuredClone(test.expected);
      actual.warnings = [];
      expect(grade(test, actual).missingWarnings).toHaveLength(1);
      expect(grade(test, actual).passed).toBe(false);
    }
  });
  it('calcule le cache et ne facture pas deux fois les tokens de raisonnement', () => {
    const usage = readUsage({
      model: 'test-snapshot',
      service_tier: 'default',
      usage: {
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 300 },
      },
    });
    expect(estimatedCost(usage, pricing)).toBeCloseTo(0.00282, 8);
    expect(readUsage({ usage: { input_tokens: -1, output_tokens: 0 } })).toBeNull();
    expect(
      readUsage({
        usage: { input_tokens: 10, output_tokens: 0, input_tokens_details: { cached_tokens: 20 } },
      }),
    ).toBeNull();
    expect(estimatedCost(null, pricing)).toBeNull();
    expect(estimatedCost({ ...usage!, model: 'other' }, pricing)).toBeNull();
    expect(estimatedCost({ ...usage!, tier: 'priority' }, pricing)).toBeNull();
    expect(estimatedCost({ ...usage!, cacheWrite: 1 }, pricing)).toBeNull();
    expect(() => validatePricing({ ...pricing, inputUsdPerMillion: -1 })).toThrow();
  });
  it('ne permet pas de présenter une simulation ou un jeu incomplet comme prêt à activer', () => {
    const results: CaseResult[] = [1, 2].flatMap((repetition) =>
      corpus.map((test) => ({
        id: test.id,
        repetition,
        split: test.split,
        sha256: test.sha256,
        durationMs: 10,
        usage: null,
        estimatedUsd: 0.001,
        error: null,
        grade: grade(test, test.expected),
      })),
    );
    expect(summarize(results, corpus.length, 2, false).recommendation).toBe('DO_NOT_ACTIVATE');
    expect(summarize(results.slice(1), corpus.length, 2, true).recommendation).toBe(
      'DO_NOT_ACTIVATE',
    );
    expect(summarize(results, corpus.length, 2, true).recommendation).toBe('HUMAN_REVIEW_REQUIRED');
    results[0].estimatedUsd = null;
    expect(summarize(results, corpus.length, 2, true).recommendation).toBe('DO_NOT_ACTIVATE');
  });

  it('exécute le même driver que le produit, mesure chaque appel et respecte le nombre maximal', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              model: 'test-snapshot',
              service_tier: 'default',
              status: 'completed',
              usage: { input_tokens: 1000, output_tokens: 500 },
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: JSON.stringify(standard().expected) }],
                },
              ],
            }),
          ),
      );
    const progress = jest.fn().mockResolvedValue(undefined);
    const run = await runCampaign(
      [standard()],
      {
        apiKey: 'fake-test-key',
        model: 'test',
        pricing,
        repetitions: 3,
        maxCalls: 2,
        budgetUsd: 1,
        transport,
      },
      progress,
    );
    expect(run.results).toHaveLength(2);
    expect(run.stopReason).toBe('CALL_OR_BUDGET_LIMIT');
    expect(run.results.every((r) => r.grade?.passed && r.estimatedUsd === 0.003)).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(sent.store).toBe(false);
    expect(sent).not.toHaveProperty('expected');
    expect(sent.input[0].content[1].type).toBe('input_file');
  });

  it('n’engage aucun appel au-delà du budget prévisionnel et s’arrête si le coût devient inconnu', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('provider error', { status: 503 }));
    const options = {
      apiKey: 'fake-test-key',
      model: 'test',
      pricing,
      repetitions: 2,
      maxCalls: 10,
      budgetUsd: 0.0001,
      transport,
    };
    expect((await runCampaign([standard()], options, async () => {})).results).toHaveLength(0);
    expect(transport).not.toHaveBeenCalled();
    const result = await runCampaign([standard()], { ...options, budgetUsd: 1 }, async () => {});
    expect(result.stopReason).toBe('UNKNOWN_COST_STOP');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ error: 'PROVIDER_ERROR', estimatedUsd: null });
  });

  it('compte le coût même si le modèle renvoie une sortie structurée invalide', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              model: 'test-snapshot',
              service_tier: 'default',
              status: 'completed',
              usage: { input_tokens: 1000, output_tokens: 500 },
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }],
            }),
          ),
      );
    const result = await runCampaign(
      [standard()],
      {
        apiKey: 'test',
        model: 'test',
        pricing,
        repetitions: 1,
        maxCalls: 1,
        budgetUsd: 1,
        transport,
      },
      async () => {},
    );
    expect(result.results[0]).toMatchObject({ error: 'INVALID_RESULT', estimatedUsd: 0.003 });
  });
});
