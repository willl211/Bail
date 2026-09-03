'use client';

import { useState } from 'react';
import type { GuarantorKind, TenantFileView } from '@/lib/api';
import * as fmt from '@/lib/format';
import { deleteGuarantor, saveGuarantor, type TenantFailure } from '@/lib/tenant-client';

/** « 4 100 » → 410000 centimes. */
function toCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const euros = Number(cleaned);
  return Number.isFinite(euros) ? Math.round(euros * 100) : null;
}

export function TenantGuarantorForm({
  file,
  readOnly,
  onChange,
}: {
  file: TenantFileView;
  readOnly: boolean;
  onChange: (view: TenantFileView) => void;
}) {
  const guarantor = file.guarantor;
  const [open, setOpen] = useState(guarantor !== null);
  const [kind, setKind] = useState<GuarantorKind>(guarantor?.kind ?? 'INDIVIDUAL');
  const [form, setForm] = useState({
    firstName: guarantor?.firstName ?? '',
    lastName: guarantor?.lastName ?? '',
    organisationName: guarantor?.organisationName ?? '',
    relationship: guarantor?.relationship ?? '',
    income:
      guarantor?.netMonthlyIncomeCents === null ||
      guarantor?.netMonthlyIncomeCents === undefined
        ? ''
        : String(Math.round(guarantor.netMonthlyIncomeCents / 100)),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TenantFailure | null>(null);

  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onChange(
        await saveGuarantor({
          kind,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          organisationName: form.organisationName || undefined,
          relationship: form.relationship || undefined,
          netMonthlyIncomeCents: toCents(form.income) ?? undefined,
        }),
      );
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      onChange(await deleteGuarantor());
      setOpen(false);
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setPending(false);
    }
  };

  if (!open) {
    return (
      <div className="panel pad">
        <p className="p-sm">
          La plupart des propriétaires à Metz en exigent un. Sans garant, votre
          dossier reste valable, mais il ne passera pas sur les biens qui en
          demandent un.
        </p>
        {readOnly ? null : (
          <button
            type="button"
            className="btn btn--ghost btn-sm mt-12"
            onClick={() => setOpen(true)}
          >
            Déclarer un garant
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="panel pad">
      <form className="form form--2" onSubmit={submit} noValidate>
        <label className="field form__full">
          <span className="label label--ink">Type de garant</span>
          <select
            className="field__box"
            value={kind}
            disabled={readOnly}
            onChange={(event) => setKind(event.target.value as GuarantorKind)}
          >
            <option value="INDIVIDUAL">Une personne (parent, proche, employeur)</option>
            <option value="ORGANISATION">
              Un organisme (Visale, caution bancaire)
            </option>
          </select>
        </label>

        {kind === 'INDIVIDUAL' ? (
          <>
            <label className="field">
              <span className="label label--ink">Prénom</span>
              <input
                className="field__box"
                required
                value={form.firstName}
                disabled={readOnly}
                onChange={set('firstName')}
              />
            </label>
            <label className="field">
              <span className="label label--ink">Nom</span>
              <input
                className="field__box"
                required
                value={form.lastName}
                disabled={readOnly}
                onChange={set('lastName')}
              />
            </label>
            <label className="field">
              <span className="label label--ink">Lien avec vous</span>
              <input
                className="field__box"
                placeholder="Mère, employeur, ami·e"
                value={form.relationship}
                disabled={readOnly}
                onChange={set('relationship')}
              />
            </label>
            <label className="field">
              <span className="label label--ink">Revenus nets mensuels</span>
              <input
                className="field__box"
                inputMode="numeric"
                placeholder="4 100"
                value={form.income}
                disabled={readOnly}
                onChange={set('income')}
              />
            </label>
          </>
        ) : (
          <label className="field form__full">
            <span className="label label--ink">Nom de l’organisme</span>
            <input
              className="field__box"
              required
              placeholder="Visale — Action Logement"
              value={form.organisationName}
              disabled={readOnly}
              onChange={set('organisationName')}
            />
            <span className="field__hint">
              Un organisme n’a pas de revenus à déclarer : seule son attestation
              de garantie est demandée.
            </span>
          </label>
        )}

        {error ? (
          <p className="form__full auth__error" role="alert">
            {error.message}
          </p>
        ) : null}

        {readOnly ? null : (
          <div className="form__full flex gap-12 wrap ai-c">
            <button type="submit" className="btn btn-sm" disabled={pending}>
              {pending ? 'Enregistrement…' : guarantor ? 'Mettre à jour' : 'Enregistrer'}
            </button>
            {guarantor ? (
              <button
                type="button"
                className="link"
                onClick={remove}
                disabled={pending}
              >
                Retirer le garant
              </button>
            ) : (
              <button
                type="button"
                className="link"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Annuler
              </button>
            )}
          </div>
        )}
      </form>

      {guarantor?.kind === 'INDIVIDUAL' && guarantor.netMonthlyIncomeCents !== null ? (
        <p className="field__hint mt-12">
          Revenus du garant enregistrés :{' '}
          {fmt.euros(guarantor.netMonthlyIncomeCents)} nets par mois.
        </p>
      ) : null}
    </div>
  );
}
