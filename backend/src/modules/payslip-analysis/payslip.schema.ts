export const PAYSLIP_PROMPT_VERSION = 'payslip-extraction-v1';
export const FIELD_KEYS = [
  'employeeName',
  'employerName',
  'periodStart',
  'periodEnd',
  'netBeforeTaxCents',
  'netPaidCents',
  'netTaxableCents',
] as const;
export type PayslipFieldKey = (typeof FIELD_KEYS)[number];
export interface ExtractedField<T> {
  value: T | null;
  page: number | null;
  evidence: string | null;
}
export interface PayslipExtraction {
  kind: 'PAYSLIP' | 'OTHER' | 'UNREADABLE';
  employeeName: ExtractedField<string>;
  employerName: ExtractedField<string>;
  periodStart: ExtractedField<string>;
  periodEnd: ExtractedField<string>;
  netBeforeTaxCents: ExtractedField<number>;
  netPaidCents: ExtractedField<number>;
  netTaxableCents: ExtractedField<number>;
  warnings: ('BLURRY' | 'CROPPED' | 'MULTIPLE_PAYSLIPS' | 'INSTRUCTIONS_IN_DOCUMENT')[];
}

const WARNINGS = ['BLURRY', 'CROPPED', 'MULTIPLE_PAYSLIPS', 'INSTRUCTIONS_IN_DOCUMENT'];
const fieldSchema = (type: 'string' | 'integer') => ({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'page', 'evidence'],
  properties: {
    value: { type: [type, 'null'] },
    page: { type: ['integer', 'null'] },
    evidence: { type: ['string', 'null'] },
  },
});
export const PAYSLIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', ...FIELD_KEYS, 'warnings'],
  properties: {
    kind: { type: 'string', enum: ['PAYSLIP', 'OTHER', 'UNREADABLE'] },
    ...Object.fromEntries(
      FIELD_KEYS.map((key) => [key, fieldSchema(key.endsWith('Cents') ? 'integer' : 'string')]),
    ),
    warnings: { type: 'array', items: { type: 'string', enum: WARNINGS } },
  },
};

export class AnalysisFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
export function isDateOnly(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** La sortie du modèle reste une entrée non fiable, même avec JSON Schema strict. */
export function parsePayslipExtraction(value: unknown, maxPages = 10): PayslipExtraction {
  const invalid = () => {
    throw new AnalysisFailure('INVALID_RESULT');
  };
  if (!object(value) || !exactKeys(value, ['kind', ...FIELD_KEYS, 'warnings'])) return invalid();
  if (!['PAYSLIP', 'OTHER', 'UNREADABLE'].includes(String(value.kind))) return invalid();
  if (
    !Array.isArray(value.warnings) ||
    value.warnings.length > 4 ||
    new Set(value.warnings).size !== value.warnings.length ||
    value.warnings.some((warning) => typeof warning !== 'string' || !WARNINGS.includes(warning))
  )
    return invalid();
  for (const key of FIELD_KEYS) {
    const field = value[key];
    if (!object(field) || !exactKeys(field, ['value', 'page', 'evidence'])) return invalid();
    if (field.value === null) {
      if (field.page !== null || field.evidence !== null) return invalid();
      continue;
    }
    if (value.kind !== 'PAYSLIP') return invalid();
    if (
      !Number.isInteger(field.page) ||
      (field.page as number) < 1 ||
      (field.page as number) > maxPages ||
      typeof field.evidence !== 'string' ||
      !field.evidence.trim() ||
      field.evidence.length > 240
    )
      return invalid();
    if (key.endsWith('Cents')) {
      if (
        !Number.isSafeInteger(field.value) ||
        (field.value as number) < 0 ||
        (field.value as number) > 100_000_000
      )
        return invalid();
    } else if (
      typeof field.value !== 'string' ||
      !field.value.trim() ||
      field.value.length > 160 ||
      (key.startsWith('period') && !isDateOnly(field.value))
    )
      return invalid();
  }
  const parsed = value as unknown as PayslipExtraction;
  if (
    parsed.periodStart.value &&
    parsed.periodEnd.value &&
    parsed.periodStart.value > parsed.periodEnd.value
  )
    return invalid();
  return parsed;
}
