'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CurrentUser } from '@/lib/api';
import { saveOwnerContact } from '@/lib/owner-profile-client';
import { requestEmailChange, type AuthFailure } from '@/lib/auth-client';

export function OwnerAccountForm({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const [contact, setContact] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [emailError, setEmailError] = useState('');
  const saveContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await saveOwnerContact(contact);
      setContact({
        firstName: result.firstName,
        lastName: result.lastName,
        phone: result.phone ?? '',
      });
      setSaved(true);
      router.refresh();
    } catch (failure) {
      setError((failure as AuthFailure).message);
    } finally {
      setSaving(false);
    }
  };
  const changeEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setEmailError('');
    setSentTo('');
    try {
      await requestEmailChange(email.trim().toLowerCase(), password);
      setSentTo(email.trim().toLowerCase());
      setPassword('');
    } catch (failure) {
      setEmailError((failure as AuthFailure).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      <section className="owner-account-section">
        <div className="owner-account-section__head">
          <span className="label">01 · Identité</span>
          <h2>Vos informations personnelles</h2>
          <p>Les coordonnées utilisées dans votre espace propriétaire.</p>
        </div>
        <form className="form form--2" onSubmit={saveContact}>
          {(
            [
              ['firstName', 'Prénom', 'given-name'],
              ['lastName', 'Nom', 'family-name'],
              ['phone', 'Téléphone', 'tel'],
            ] as const
          ).map(([key, label, autocomplete]) => (
            <label key={key} className={`field${key === 'phone' ? ' form__full' : ''}`}>
              <span className="label label--ink">
                {label}
                {key === 'phone' ? ' (facultatif)' : ''}
              </span>
              <input
                className="field__box"
                name={key}
                autoComplete={autocomplete}
                type={key === 'phone' ? 'tel' : 'text'}
                required={key !== 'phone'}
                maxLength={key === 'phone' ? 30 : 80}
                value={contact[key]}
                disabled={saving}
                onChange={(event) => {
                  setContact({ ...contact, [key]: event.target.value });
                  setSaved(false);
                }}
              />
            </label>
          ))}
          {error ? (
            <p className="form__full auth__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form__full flex ai-c gap-12 wrap">
            <button className="btn" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer mes informations'}
            </button>
            {saved ? (
              <span role="status" className="badge badge--ok">
                Informations enregistrées
              </span>
            ) : null}
          </div>
        </form>
      </section>
      <section className="owner-account-section">
        <div className="owner-account-section__head">
          <span className="label">02 · Connexion</span>
          <h2>Votre adresse e-mail</h2>
          <p>
            Adresse actuelle : <strong>{user.email}</strong>
          </p>
          <p>
            La nouvelle adresse remplace l’ancienne après confirmation du lien reçu par e-mail.
          </p>
        </div>
        <form className="form form--2" onSubmit={changeEmail}>
          <label className="field form__full">
            <span className="label label--ink">Nouvelle adresse e-mail</span>
            <input
              className="field__box"
              type="email"
              name="newEmail"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              disabled={sending}
              onChange={(event) => {
                setEmail(event.target.value);
                setSentTo('');
              }}
            />
          </label>
          <label className="field form__full">
            <span className="label label--ink">Mot de passe actuel</span>
            <input
              className="field__box"
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              maxLength={200}
              required
              value={password}
              disabled={sending}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span className="field__hint">
              Il confirme que vous êtes à l’origine de ce changement.
            </span>
          </label>
          {emailError ? (
            <p className="form__full auth__error" role="alert">
              {emailError}
            </p>
          ) : null}
          {sentTo ? (
            <p className="form__full owner-account-success" role="status">
              Un lien de confirmation a été envoyé à <strong>{sentTo}</strong>. Votre adresse
              actuelle reste active jusqu’à sa validation.
            </p>
          ) : null}
          <div className="form__full">
            <button
              className="btn btn--ghost"
              disabled={sending || email.trim().toLowerCase() === user.email}
            >
              {sending ? 'Envoi…' : 'Confirmer ma nouvelle adresse'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
