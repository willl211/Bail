'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { login, register, type AuthFailure } from '@/lib/auth-client';

type Mode = 'signup' | 'login';

/**
 * Inscription et connexion propriétaire, sur un seul écran à deux onglets —
 * comme dans la maquette (`auth__tabs`).
 *
 * Le formulaire s'adresse à l'API depuis le navigateur : c'est elle qui pose le
 * cookie de session. Après succès, `router.refresh()` force Next à re-rendre
 * les composants serveur, qui verront alors la session.
 */
export function OwnerAuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signup');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });

  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      if (mode === 'signup') {
        await register({
          email: form.email,
          password: form.password,
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone || undefined,
          role: 'OWNER',
        });
      } else {
        await login(form.email, form.password);
      }
      router.replace('/proprietaires/biens');
      router.refresh();
    } catch (failure) {
      setError(failure as AuthFailure);
      setPending(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <>
      <div className="auth__tabs">
        <button
          type="button"
          className="auth__tab"
          aria-pressed={mode === 'signup'}
          onClick={() => switchMode('signup')}
        >
          Créer un compte
        </button>
        <button
          type="button"
          className="auth__tab"
          aria-pressed={mode === 'login'}
          onClick={() => switchMode('login')}
        >
          Se connecter
        </button>
      </div>

      <form className="form form--2" onSubmit={submit} noValidate>
        {mode === 'signup' ? (
          <>
            <label className="field">
              <span className="label label--ink">Prénom</span>
              <input
                className="field__box"
                required
                autoComplete="given-name"
                value={form.firstName}
                onChange={set('firstName')}
              />
            </label>
            <label className="field">
              <span className="label label--ink">Nom</span>
              <input
                className="field__box"
                required
                autoComplete="family-name"
                value={form.lastName}
                onChange={set('lastName')}
              />
            </label>
          </>
        ) : null}

        <label className="field form__full">
          <span className="label label--ink">Adresse e-mail</span>
          <input
            className="field__box"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
          />
        </label>

        {mode === 'signup' ? (
          <label className="field">
            <span className="label label--ink">Téléphone</span>
            <input
              className="field__box"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={set('phone')}
            />
          </label>
        ) : null}

        <label className={mode === 'signup' ? 'field' : 'field form__full'}>
          <span className="label label--ink">Mot de passe</span>
          <input
            className="field__box"
            type="password"
            required
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={form.password}
            onChange={set('password')}
          />
          {mode === 'signup' ? (
            <span className="field__hint">12 caractères minimum.</span>
          ) : null}
        </label>

        {error ? (
          <p className="form__full auth__error" role="alert">
            {error.message}
          </p>
        ) : null}

        <div className="form__full flex gap-12 wrap ai-c">
          <button type="submit" className="btn" disabled={pending}>
            {pending
              ? 'Envoi…'
              : mode === 'signup'
                ? 'Créer mon compte'
                : 'Se connecter'}
          </button>
          <span className="label">
            {mode === 'signup' ? 'Sans engagement' : 'Accès à votre espace'}
          </span>
        </div>
      </form>
    </>
  );
}
