'use client';

import { useState } from 'react';
import type { GuarantorKind, TenantFileView } from '@/lib/api';
import { deleteGuarantor, saveGuarantor, type TenantFailure } from '@/lib/tenant-client';

type Choice = GuarantorKind | 'NONE';
const CHOICES = [
  ['INDIVIDUAL', 'Une personne', 'Parent, proche, employeur'],
  ['ORGANISATION', 'Un organisme', 'Visale, caution bancaire'],
  ['NONE', 'Aucun garant', 'Continuer sans garant'],
] as const;

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
  const [kind, setKind] = useState<Choice>(guarantor?.kind ?? 'NONE');
  const values = () => ({
    firstName: guarantor?.firstName ?? '',
    lastName: guarantor?.lastName ?? '',
    organisationName: guarantor?.organisationName ?? '',
    relationship: guarantor?.relationship ?? '',
    income:
      guarantor?.netMonthlyIncomeCents == null
        ? ''
        : String(guarantor.netMonthlyIncomeCents / 100),
  });
  const [form, setForm] = useState(values);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TenantFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setSaved(false);
  };
  const reset = () => {
    setKind(guarantor?.kind ?? 'NONE');
    setForm(values());
    setError(null);
    setSaved(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || readOnly || kind === 'NONE') return;
    setPending(true);
    setError(null);
    setSaved(false);
    const income = form.income.trim()
      ? Number(form.income.replace(/\s/g, '').replace(',', '.'))
      : undefined;
    if (
      kind === 'INDIVIDUAL' &&
      income !== undefined &&
      (!Number.isFinite(income) || income < 0)
    ) {
      setError({ message: 'Indiquez des revenus valides en euros.' });
      setPending(false);
      return;
    }
    try {
      const next = await saveGuarantor(
        kind === 'ORGANISATION'
          ? { kind, organisationName: form.organisationName.trim() }
          : {
              kind,
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
              relationship: form.relationship || undefined,
              netMonthlyIncomeCents:
                income === undefined ? undefined : Math.round(income * 100),
            },
      );
      onChange(next);
      setSaved(true);
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    if (pending || readOnly || !guarantor) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      onChange(await deleteGuarantor());
      setKind('NONE');
      setForm({
        firstName: '',
        lastName: '',
        organisationName: '',
        relationship: '',
        income: '',
      });
      setSaved(true);
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="tenant-guarantor">
      <fieldset className="tenant-guarantor-choices" disabled={readOnly || pending}>
        <legend>Qui se porte garant pour vous ?</legend>
        {CHOICES.map(([value, label, hint]) => (
          <label className={kind === value ? 'is-selected' : ''} key={value}>
            <input
              type="radio"
              name="guarantor-kind"
              value={value}
              checked={kind === value}
              onChange={() => {
                setKind(value);
                setSaved(false);
                setError(null);
              }}
            />
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {kind === 'NONE' ? (
        <div className="tenant-guarantor-none">
          {guarantor ? (
            <>
              <h3>Retirer le garant enregistré ?</h3>
              <p>
                Son identité et ses justificatifs seront retirés du dossier. Le garant actuel
                reste enregistré tant que vous ne confirmez pas.
              </p>
              {readOnly ? null : (
                <div className="flex gap-12 wrap mt-16">
                  <button
                    type="button"
                    className="btn btn--ghost btn-sm"
                    onClick={remove}
                    disabled={pending}
                  >
                    {pending ? 'Retrait…' : 'Confirmer le retrait du garant'}
                  </button>
                  <button type="button" className="link" onClick={reset} disabled={pending}>
                    Conserver mon garant
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <h3>Vous continuez sans garant</h3>
              <p>
                Votre dossier peut être préparé sans garant. Certaines annonces en demandent un
                : vous pourrez l’ajouter ici avant de candidater.
              </p>
            </>
          )}
        </div>
      ) : (
        <form className="form form--2 tenant-form-panel" onSubmit={submit}>
          {kind === 'INDIVIDUAL' ? (
            <>
              <label className="field">
                <span className="label label--ink">Prénom</span>
                <input
                  className="field__box"
                  required
                  value={form.firstName}
                  disabled={readOnly || pending}
                  onChange={set('firstName')}
                />
              </label>
              <label className="field">
                <span className="label label--ink">Nom</span>
                <input
                  className="field__box"
                  required
                  value={form.lastName}
                  disabled={readOnly || pending}
                  onChange={set('lastName')}
                />
              </label>
              <label className="field">
                <span className="label label--ink">Lien avec vous</span>
                <input
                  className="field__box"
                  value={form.relationship}
                  placeholder="Parent, proche, employeur…"
                  disabled={readOnly || pending}
                  onChange={set('relationship')}
                />
              </label>
              <label className="field">
                <span className="label label--ink">Revenus nets mensuels</span>
                <input
                  className="field__box"
                  inputMode="decimal"
                  value={form.income}
                  disabled={readOnly || pending}
                  onChange={set('income')}
                />
                <span className="field__hint">Montant en euros.</span>
              </label>
            </>
          ) : (
            <label className="field form__full">
              <span className="label label--ink">Nom de l’organisme</span>
              <input
                className="field__box"
                required
                value={form.organisationName}
                placeholder="Visale — Action Logement"
                disabled={readOnly || pending}
                onChange={set('organisationName')}
              />
              <span className="field__hint">
                Seule l’attestation de garantie sera demandée.
              </span>
            </label>
          )}
          {readOnly ? null : (
            <>
              <p className="form__full tenant-edit-note">
                L’enregistrement du garant relance le contrôle si votre dossier était déjà
                vérifié.
              </p>
              <div className="form__full flex gap-12 wrap">
                <button className="btn btn-sm" disabled={pending}>
                  {pending ? 'Enregistrement…' : 'Enregistrer mon garant'}
                </button>
                <button type="button" className="link" disabled={pending} onClick={reset}>
                  Annuler
                </button>
              </div>
            </>
          )}
        </form>
      )}
      {error ? (
        <p className="auth__error mt-16" role="alert">
          {error.message}
        </p>
      ) : null}
      {saved ? (
        <p className="field__hint mt-16" role="status">
          {guarantor
            ? 'Les informations du garant sont enregistrées.'
            : 'Vous continuez sans garant.'}
        </p>
      ) : null}
    </div>
  );
}
