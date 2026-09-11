import { PDFDocument, StandardFonts } from 'pdf-lib';
import type {
  ExtractedField,
  PayslipExtraction,
} from '../src/modules/payslip-analysis/payslip.schema';

export const readField = <T extends string | number>(
  value: T,
  evidence = String(value),
): ExtractedField<T> => ({ value, evidence, page: 1 });
export const unreadField = (): ExtractedField<never> => ({
  value: null,
  evidence: null,
  page: null,
});
export function samplePayslip(): PayslipExtraction {
  return {
    kind: 'PAYSLIP',
    employeeName: readField('Awa Diallo'),
    employerName: readField('Studio Sud'),
    periodStart: readField('2026-08-01', 'Periode du 01/08/2026 au 31/08/2026'),
    periodEnd: readField('2026-08-31', 'Periode du 01/08/2026 au 31/08/2026'),
    netBeforeTaxCents: readField(200000, 'Net a payer avant impot : 2 000,00 EUR'),
    netPaidCents: readField(190000, 'Net paye : 1 900,00 EUR'),
    netTaxableCents: readField(210000, 'Net imposable mensuel : 2 100,00 EUR'),
    warnings: [],
  };
}

/** Document fictif de test, sans donnée d'une personne réelle. */
export async function fictionalPayslipPdf(pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText('SPECIMEN FICTIF - AUCUNE VALEUR DE JUSTIFICATIF', {
      x: 40,
      y: 780,
      size: 13,
      font,
    });
    page.drawText(
      'Bulletin de salaire - Awa Diallo - Studio Sud\nPeriode du 01/08/2026 au 31/08/2026\nNet a payer avant impot : 2 000,00 EUR\nNet paye : 1 900,00 EUR\nNet imposable mensuel : 2 100,00 EUR',
      { x: 40, y: 720, size: 14, font, lineHeight: 28 },
    );
  }
  return Buffer.from(await pdf.save());
}
