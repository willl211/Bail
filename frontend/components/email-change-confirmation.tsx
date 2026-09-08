'use client';

import { useState } from 'react';
import { confirmEmailChange, type AuthFailure } from '@/lib/auth-client';

/** Confirmation explicite : un robot qui prévisualise le lien ne modifie pas le compte. */
export function EmailChangeConfirmation({ token }: { token: string | null }) {
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(token ? '' : 'Ce lien est incomplet.');
  const confirm = async () => {
    if (!token) return;
    setPending(true);
    setError('');
    try {
      const result = await confirmEmailChange(token);
      setEmail(result.email);
      window.history.replaceState(null, '', '/changement-email');
    } catch (failure) {
      setError((failure as AuthFailure).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <main className="page page--narrow">
      <section className="panel pad-lg">
        <span className="label label--accent">Mon compte</span>
        <h1 className="d3 mt-8">
          {email ? 'Votre adresse a été modifiée' : 'Confirmer votre nouvelle adresse'}
        </h1>
        {email ? (
          <>
            <p className="p-sm mt-16">
              Utilisez désormais <strong>{email}</strong> avec votre mot de passe habituel. Vos
              sessions ont été fermées.
            </p>
            <a href="/connexion" className="btn mt-20">
              Me reconnecter
            </a>
          </>
        ) : (
          <>
            <p className="p-sm mt-16">
              Cette action remplacera votre adresse de connexion et fermera vos sessions
              actuelles.
            </p>
            {error ? (
              <p role="alert" className="auth__error mt-16">
                {error}
              </p>
            ) : null}
            <div className="flex wrap gap-12 mt-20">
              <button className="btn" onClick={confirm} disabled={!token || pending}>
                {pending ? 'Confirmation…' : 'Confirmer le changement'}
              </button>
              <a href="/proprietaires/compte" className="btn btn--ghost">
                Retour à mon compte
              </a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
