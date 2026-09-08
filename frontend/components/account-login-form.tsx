'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { login, type AuthFailure } from '@/lib/auth-client';
import {
  accountDestination,
  accountEntry,
  type AccountIntent,
} from '@/lib/account-navigation';

export function AccountLoginForm({ intent = {} }: { intent?: AccountIntent }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const { user } = await login(email.trim(), password);
      router.replace(accountDestination(user.role, intent));
      router.refresh();
    } catch (failure) {
      setError((failure as AuthFailure).message);
      setPending(false);
    }
  }

  return (
    <>
      <form className="form account-login" onSubmit={submit}>
        <label className="field">
          <span className="label label--ink">Adresse e-mail</span>
          <input
            className="field__box"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </label>
        <label className="field">
          <span className="label label--ink">Mot de passe</span>
          <input
            className="field__box"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </label>
        <Link href="/mot-de-passe-oublie" className="account-login__forgot link">
          Mot de passe oublié ?
        </Link>
        {error ? (
          <p className="auth__error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn" disabled={pending}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <section className="account-signup" aria-labelledby="account-signup-title">
        <h2 id="account-signup-title">Pas encore de compte ?</h2>
        <p>Choisissez ce que vous souhaitez faire.</p>
        <Link href={accountEntry('/dossier', intent)} className="account-signup__choice">
          <span>
            <strong>Je cherche un logement</strong>
            <small>Créer mon dossier locataire, gratuitement</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/proprietaires" className="account-signup__choice">
          <span>
            <strong>Je mets un bien en location</strong>
            <small>Créer mon espace propriétaire</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </>
  );
}
