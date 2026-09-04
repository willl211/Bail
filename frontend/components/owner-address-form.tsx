'use client';

import { useState } from 'react';
import type { OwnerProfile } from '@/lib/api';
import { saveOwnerProfile, type ProfileFailure } from '@/lib/owner-profile-client';

/**
 * Coordonnées postales du bailleur.
 *
 * Obligatoires au bail (loi n° 89-462 du 6 juillet 1989, article 3) : sans
 * elles, le locataire n'a pas d'adresse où adresser un congé, une réclamation
 * ou une mise en demeure. L'écran le dit, plutôt que de réclamer trois champs
 * de plus sans expliquer pourquoi.
 *
 * Elles ne sont demandées ni à l'inscription — l'étape la plus fragile du
 * parcours — ni au dépôt d'une annonce : c'est la signature du bail qu'elles
 * conditionnent, et c'est à ce moment-là qu'elles manqueraient.
 */
export function OwnerAddressForm({ initial }: { initial: OwnerProfile }) {
  const [profile, setProfile] = useState(initial);
  const [form, setForm] = useState({
    addressLine: initial.addressLine ?? '',
    postalCode: initial.postalCode ?? '',
    city: initial.city ?? '',
  });
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ProfileFailure | null>(null);

  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setSaved(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setProfile(await saveOwnerProfile(form));
      setSaved(true);
    } catch (failure) {
      setError(failure as ProfileFailure);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="panel panel--strong pad-lg">
      <div className="flex jc-b ai-c gap-12 wrap">
        <span className="label label--accent">Coordonnées du bailleur</span>
        {profile.complete ? (
          <span className="badge badge--ok">Complètes</span>
        ) : (
          <span className="badge badge--pending">À renseigner</span>
        )}
      </div>

      <h1 className="d3 mt-8">Votre adresse</h1>
      <p className="p-sm mt-12">
        Elle figure au bail, comme l’exige la loi du 6 juillet 1989 : c’est
        l’adresse à laquelle votre locataire pourra vous notifier un congé ou une
        réclamation. Elle n’apparaît sur aucune annonce.
      </p>

      <form className="form form--2 mt-20" onSubmit={submit} noValidate>
        <label className="field form__full">
          <span className="label label--ink">Numéro et voie</span>
          <input
            className="field__box"
            required
            autoComplete="street-address"
            value={form.addressLine}
            onChange={set('addressLine')}
            placeholder="9 rue Serpenoise"
          />
        </label>

        <label className="field">
          <span className="label label--ink">Code postal</span>
          <input
            className="field__box"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            value={form.postalCode}
            onChange={set('postalCode')}
            placeholder="57000"
          />
        </label>

        <label className="field">
          <span className="label label--ink">Commune</span>
          <input
            className="field__box"
            required
            autoComplete="address-level2"
            value={form.city}
            onChange={set('city')}
            placeholder="Metz"
          />
        </label>

        {error ? (
          <p className="form__full auth__error" role="alert">
            {error.message}
          </p>
        ) : null}

        <div className="form__full flex gap-12 wrap ai-c">
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {saved ? (
            <span className="badge badge--ok" role="status">
              Enregistré
            </span>
          ) : (
            <span className="label">Modifiable à tout moment</span>
          )}
        </div>
      </form>
    </div>
  );
}
