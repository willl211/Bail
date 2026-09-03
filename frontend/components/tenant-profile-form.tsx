'use client';

import { useState } from 'react';
import type { EmploymentContractType, TenantFileView } from '@/lib/api';
import * as fmt from '@/lib/format';
import { updateProfile, type TenantFailure } from '@/lib/tenant-client';

/**
 * Situations proposées.
 *
 * L'ordre suit la fréquence réelle à Metz : salariés d'abord, étudiants juste
 * après — un tiers du marché locatif messin (docs/market-context.md).
 */
const SITUATIONS: { value: EmploymentContractType; label: string }[] = [
  { value: 'CDI', label: 'Salarié·e en CDI' },
  { value: 'STUDENT', label: 'Étudiant·e ou alternant·e' },
  { value: 'CDD', label: 'Salarié·e en CDD' },
  { value: 'PUBLIC_SECTOR', label: 'Fonction publique' },
  { value: 'SELF_EMPLOYED', label: 'Indépendant·e' },
  { value: 'RETIRED', label: 'Retraité·e' },
  { value: 'OTHER', label: 'Autre situation' },
];

/** « 2 980 » → 298000 centimes. Espaces et symboles sont tolérés à la saisie. */
function toCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const euros = Number(cleaned);
  return Number.isFinite(euros) ? Math.round(euros * 100) : null;
}

export function TenantProfileForm({
  file,
  readOnly,
  onChange,
}: {
  file: TenantFileView;
  readOnly: boolean;
  onChange: (view: TenantFileView) => void;
}) {
  const [situation, setSituation] = useState<string>(file.contractType ?? '');
  const [employer, setEmployer] = useState(file.employerName ?? '');
  const [income, setIncome] = useState(
    file.netMonthlyIncomeCents === null
      ? ''
      : String(Math.round(file.netMonthlyIncomeCents / 100)),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TenantFailure | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    const cents = toCents(income);
    if (income !== '' && cents === null) {
      setError({ message: 'Revenus illisibles. Indiquez un montant en euros.' });
      setPending(false);
      return;
    }

    try {
      onChange(
        await updateProfile({
          contractType: situation === '' ? undefined : (situation as EmploymentContractType),
          employerName: employer,
          netMonthlyIncomeCents: cents ?? undefined,
        }),
      );
      setSaved(true);
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="form form--2" onSubmit={submit} noValidate>
      <label className="field">
        <span className="label label--ink">Situation</span>
        <select
          className="field__box"
          value={situation}
          disabled={readOnly}
          onChange={(event) => {
            setSituation(event.target.value);
            setSaved(false);
          }}
        >
          <option value="">À renseigner</option>
          {SITUATIONS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <span className="field__hint">
          Elle détermine les pièces qu’on vous demande.
        </span>
      </label>

      <label className="field">
        <span className="label label--ink">
          {situation === 'STUDENT' ? 'Établissement' : 'Employeur'}
        </span>
        <input
          className="field__box"
          value={employer}
          disabled={readOnly}
          onChange={(event) => {
            setEmployer(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      <label className="field">
        <span className="label label--ink">Revenus nets mensuels</span>
        <input
          className="field__box"
          inputMode="numeric"
          placeholder="2 980"
          value={income}
          disabled={readOnly}
          onChange={(event) => {
            setIncome(event.target.value);
            setSaved(false);
          }}
        />
        <span className="field__hint">
          En euros. Bourse et aides comprises si vous en percevez.
        </span>
      </label>

      <div className="field">
        <span className="label label--ink">Loyer accessible</span>
        <div className="field__readout">
          {file.maxRentCents === null ? '—' : `${fmt.euros(file.maxRentCents)} CC`}
        </div>
        <span className="field__hint">
          Le tiers de vos revenus : c’est le plafond que retiennent la plupart
          des propriétaires.
        </span>
      </div>

      {error ? (
        <p className="form__full auth__error" role="alert">
          {error.message}
        </p>
      ) : null}

      {readOnly ? null : (
        <div className="form__full flex gap-12 wrap ai-c">
          <button type="submit" className="btn btn-sm" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {saved ? <span className="label label--accent">Enregistré</span> : null}
        </div>
      )}
    </form>
  );
}
