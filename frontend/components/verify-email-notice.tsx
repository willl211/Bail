'use client';

import { useState } from 'react';
import { resendVerification, type AuthFailure } from '@/lib/auth-client';

/**
 * Rappel de confirmation d'adresse.
 *
 * Affiché en tête des espaces personnels tant que l'adresse n'est pas
 * confirmée. Ce n'est pas un blocage : on ne coupe pas l'accès à quelqu'un qui
 * vient de créer son compte parce que son fournisseur de messagerie a mis dix
 * minutes à distribuer. Ce qui dépend d'une adresse confirmée — candidater,
 * publier une annonce — est contrôlé là où c'est engageant, pas ici.
 */
export function VerifyEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setState('sending');
    setError(null);
    try {
      await resendVerification();
      setState('sent');
    } catch (failure) {
      setState('idle');
      setError((failure as AuthFailure).message);
    }
  };

  return (
    <div className="reminder" role="status">
      <div>
        <span className="label label--accent">Adresse à confirmer</span>
        <p className="p-sm mt-6">
          {state === 'sent' ? (
            <>
              Un nouveau lien vient de partir vers <b className="mono">{email}</b>. Pensez
              à regarder vos courriers indésirables.
            </>
          ) : (
            <>
              Un lien de confirmation a été envoyé à <b className="mono">{email}</b>. Tant
              qu’elle n’est pas confirmée, nous ne pouvons pas vous prévenir de ce qui
              concerne votre dossier.
            </>
          )}
        </p>
        {error ? (
          <p className="field__hint mt-6" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {state === 'sent' ? (
        <span className="badge badge--ok">Envoyé</span>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn-sm"
          onClick={resend}
          disabled={state === 'sending'}
        >
          {state === 'sending' ? 'Envoi…' : 'Renvoyer le lien'}
        </button>
      )}
    </div>
  );
}
