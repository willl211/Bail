'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { register, type AuthFailure } from '@/lib/auth-client';

export function AccountRegistrationForm({
  role,
  redirectTo,
  loginHref = '/connexion',
}: {
  role: 'OWNER' | 'TENANT';
  redirectTo?: string;
  loginHref?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await register({
        ...form,
        email: form.email.trim(),
        phone: form.phone || undefined,
        role,
      });
      router.replace(redirectTo ?? (role === 'OWNER' ? '/proprietaires/biens' : '/dossier'));
      router.refresh();
    } catch (failure) {
      setError((failure as AuthFailure).message);
      setPending(false);
    }
  }

  return (
    <>
      <p className="account-existing">
        Déjà un compte ?{' '}
        <Link href={loginHref} className="link">
          Se connecter
        </Link>
      </p>
      <form className="form form--2" onSubmit={submit}>
        <label className="field">
          <span className="label label--ink">Prénom</span>
          <input
            className="field__box"
            autoComplete="given-name"
            required
            value={form.firstName}
            onChange={set('firstName')}
            disabled={pending}
          />
        </label>
        <label className="field">
          <span className="label label--ink">Nom</span>
          <input
            className="field__box"
            autoComplete="family-name"
            required
            value={form.lastName}
            onChange={set('lastName')}
            disabled={pending}
          />
        </label>
        <label className="field form__full">
          <span className="label label--ink">Adresse e-mail</span>
          <input
            className="field__box"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
            disabled={pending}
          />
        </label>
        <label className="field form__full">
          <span className="label label--ink">Téléphone (facultatif)</span>
          <input
            className="field__box"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={set('phone')}
            disabled={pending}
          />
        </label>
        <label className="field form__full">
          <span id="signup-password-label" className="label label--ink">Mot de passe</span>
          <input
            className="field__box"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={form.password}
            onChange={set('password')}
            aria-describedby="signup-password-hint"
            aria-labelledby="signup-password-label"
            disabled={pending}
          />
          <span id="signup-password-hint" className="field__hint">
            12 caractères minimum.
          </span>
        </label>
        {error ? (
          <p className="form__full auth__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form__full account-registration-actions">
          <button className="btn" disabled={pending}>
            {pending
              ? 'Création…'
              : role === 'OWNER'
                ? 'Créer mon espace propriétaire'
                : 'Créer mon dossier locataire'}
          </button>
          <span className="field__hint">
            {role === 'OWNER' ? 'Sans engagement' : 'Gratuit · aucune carte demandée'}
          </span>
        </div>
      </form>
    </>
  );
}
