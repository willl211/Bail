import type { PayslipExtraction } from './payslip.schema';

export interface PayslipCheck {
  code: string;
  tone: 'match' | 'attention' | 'unknown';
  label: string;
  detail: string;
}
export interface DeclaredProfile {
  firstName: string;
  lastName: string;
  employerName: string | null;
  netMonthlyIncomeCents: number | null;
}
const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const name = (value: string) => normalize(value).split(/\s+/).sort().join(' ');
const euro = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/** Comparaisons reproductibles, sans score de solvabilité ni décision automatique. */
export function payslipChecks(
  extraction: PayslipExtraction,
  profile: DeclaredProfile,
  otherPeriods: string[] = [],
  today = new Date(),
): PayslipCheck[] {
  if (extraction.kind !== 'PAYSLIP')
    return [
      {
        code: 'DOCUMENT_KIND',
        tone: 'attention',
        label: 'Lecture à reprendre',
        detail:
          extraction.kind === 'OTHER'
            ? 'La pièce ne semble pas être un bulletin de salaire. Confirmez en consultant le fichier.'
            : 'Le contenu est illisible pour l’analyse. Consultez la pièce avant de demander un nouveau dépôt.',
      },
    ];
  const checks: PayslipCheck[] = [];
  const compare = (
    code: string,
    label: string,
    read: string | null,
    declared: string | null,
    normalizer = normalize,
  ) => {
    checks.push({
      code,
      label,
      tone:
        !read || !declared
          ? 'unknown'
          : normalizer(read) === normalizer(declared)
            ? 'match'
            : 'attention',
      detail: !read
        ? 'Information non lue dans le document.'
        : !declared
          ? 'Information absente du dossier déclaré.'
          : `Lu : ${read}. Déclaré : ${declared}.`,
    });
  };
  compare(
    'NAME',
    'Nom du salarié',
    extraction.employeeName.value,
    `${profile.firstName} ${profile.lastName}`,
    name,
  );
  compare('EMPLOYER', 'Employeur', extraction.employerName.value, profile.employerName);
  const start = extraction.periodStart.value,
    end = extraction.periodEnd.value;
  const date = today.toISOString().slice(0, 10);
  const monthly =
    !!start &&
    !!end &&
    start.endsWith('-01') &&
    start.slice(0, 7) === end.slice(0, 7) &&
    new Date(new Date(end).getTime() + 86_400_000).getUTCDate() === 1;
  checks.push({
    code: 'PERIOD',
    label: 'Période du bulletin',
    tone:
      !start || !end
        ? 'unknown'
        : !monthly || end > date || new Date(end).getTime() < today.getTime() - 120 * 86_400_000
          ? 'attention'
          : 'match',
    detail:
      !start || !end
        ? 'Période incomplète ou non lue.'
        : `Du ${start} au ${end}. Vérifiez que ce bulletin correspond à la période demandée.`,
  });
  if (end && otherPeriods.includes(end.slice(0, 7)))
    checks.push({
      code: 'DUPLICATE_PERIOD',
      tone: 'attention',
      label: 'Période déjà présente',
      detail:
        'Un autre bulletin analysé porte sur le même mois. Vérifiez qu’il ne remplace pas une période manquante.',
    });
  const amount = extraction.netBeforeTaxCents.value,
    declared = profile.netMonthlyIncomeCents;
  checks.push({
    code: 'INCOME',
    label: 'Net avant impôt et revenu déclaré',
    tone:
      amount === null || declared === null || !monthly
        ? 'unknown'
        : amount === declared
          ? 'match'
          : 'attention',
    detail:
      amount === null
        ? 'Net avant impôt non lu. Le net payé et le net imposable ne sont pas utilisés à sa place.'
        : declared === null
          ? 'Revenu mensuel non déclaré.'
          : !monthly
            ? 'La période ne permet pas une comparaison mensuelle.'
            : `Bulletin : ${euro(amount)}. Déclaré : ${euro(declared)}. Un écart peut venir de primes, absences ou autres revenus ; il reste à expliquer.`,
  });
  const warningLabels = {
    BLURRY: 'Document flou',
    CROPPED: 'Document partiellement coupé',
    MULTIPLE_PAYSLIPS: 'Plusieurs bulletins dans le même fichier',
    INSTRUCTIONS_IN_DOCUMENT: 'Texte pouvant chercher à influencer l’analyse',
  };
  for (const warning of extraction.warnings)
    checks.push({
      code: warning,
      tone: 'attention',
      label: warningLabels[warning],
      detail: 'Signal de lecture à confirmer sur le document original.',
    });
  return checks;
}
