import { payslipChecks } from './payslip.checks';
import { parsePayslipExtraction } from './payslip.schema';
import { samplePayslip, unreadField } from '../../../test/payslip-fixtures';

const profile = {
  firstName: 'Awa',
  lastName: 'Diallo',
  employerName: 'Studio Sud',
  netMonthlyIncomeCents: 200000,
};
const today = new Date('2026-09-10T12:00:00Z');

describe('Lecture de bulletin et comparaisons', () => {
  it('distingue les trois nets et compare exclusivement celui avant impôt', () => {
    const sample = parsePayslipExtraction(samplePayslip());
    expect(sample.netPaidCents.value).toBe(190000);
    expect(
      payslipChecks(sample, profile, [], today).find((check) => check.code === 'INCOME')?.tone,
    ).toBe('match');
    sample.netBeforeTaxCents = unreadField();
    expect(
      payslipChecks(sample, profile, [], today).find((check) => check.code === 'INCOME')?.tone,
    ).toBe('unknown');
  });
  it('accepte l’ordre prénom/nom et les accents sans accepter un autre nom', () => {
    const sample = samplePayslip();
    sample.employeeName.value = 'DÍALLO Awa';
    expect(payslipChecks(sample, profile, [], today)[0].tone).toBe('match');
    sample.employeeName.value = 'Diallo Alice';
    expect(payslipChecks(sample, profile, [], today)[0].tone).toBe('attention');
  });
  it('signale les périodes identiques sans en faire une décision de refus', () => {
    const checks = payslipChecks(samplePayslip(), profile, ['2026-08'], today);
    expect(checks.some((check) => check.code === 'DUPLICATE_PERIOD')).toBe(true);
    expect(JSON.stringify(checks)).not.toMatch(/REJECTED|VERIFIED/);
  });
  it('recalcule les écarts après modification du dossier déclaré', () => {
    const checks = payslipChecks(
      samplePayslip(),
      { ...profile, netMonthlyIncomeCents: 300000, employerName: 'Autre entreprise' },
      [],
      today,
    );
    expect(checks.find((check) => check.code === 'INCOME')?.tone).toBe('attention');
    expect(checks.find((check) => check.code === 'EMPLOYER')?.tone).toBe('attention');
  });
  it('signale un bulletin trop ancien ou daté dans le futur', () => {
    expect(payslipChecks(samplePayslip(), profile, [], new Date('2027-09-10'))[2].tone).toBe(
      'attention',
    );
    expect(payslipChecks(samplePayslip(), profile, [], new Date('2026-07-10'))[2].tone).toBe(
      'attention',
    );
  });
  it('ne compare pas un bulletin de période partielle à un revenu mensuel complet', () => {
    const sample = samplePayslip();
    sample.periodStart.value = '2026-08-24';
    expect(
      payslipChecks(sample, profile, [], today).find((check) => check.code === 'INCOME')?.tone,
    ).toBe('unknown');
    expect(
      payslipChecks(sample, profile, [], today).find((check) => check.code === 'PERIOD')?.tone,
    ).toBe('attention');
  });
  it.each([
    (v: Record<string, unknown>) => {
      v.verified = true;
    },
    (v: Record<string, unknown>) => {
      v.netBeforeTaxCents = { value: '200000', page: 1, evidence: '2000' };
    },
    (v: Record<string, unknown>) => {
      v.netBeforeTaxCents = { value: 200000.5, page: 1, evidence: '2000' };
    },
    (v: Record<string, unknown>) => {
      v.employeeName = { value: 'Awa', page: 1, evidence: null };
    },
    (v: Record<string, unknown>) => {
      v.employeeName = { value: 'Awa', page: 11, evidence: 'Awa' };
    },
    (v: Record<string, unknown>) => {
      v.periodStart = { value: '2026-02-30', page: 1, evidence: '30 février' };
    },
    (v: Record<string, unknown>) => {
      v.kind = 'OTHER';
    },
    (v: Record<string, unknown>) => {
      v.warnings = ['FRAUD_CONFIRMED'];
    },
    (v: Record<string, unknown>) => {
      v.warnings = ['BLURRY', 'BLURRY'];
    },
  ])('refuse une réponse hors contrat (%#)', (mutate) => {
    const value = samplePayslip() as unknown as Record<string, unknown>;
    mutate(value);
    expect(() => parsePayslipExtraction(value)).toThrow();
  });
  it('n’invente pas des champs pour une pièce illisible', () => {
    const sample = samplePayslip();
    sample.kind = 'UNREADABLE';
    for (const key of [
      'employeeName',
      'employerName',
      'periodStart',
      'periodEnd',
      'netBeforeTaxCents',
      'netPaidCents',
      'netTaxableCents',
    ] as const)
      sample[key] = unreadField();
    expect(payslipChecks(parsePayslipExtraction(sample), profile)).toHaveLength(1);
  });
});
