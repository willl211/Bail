'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  cancelSubscription,
  resumeSubscription,
  subscribe,
  type ApiFailure,
} from '@/lib/owner-client';

type Action = 'subscribe' | 'cancel' | 'resume';

/**
 * Souscription, résiliation, reprise.
 *
 * La résiliation demande une confirmation en deux temps : c'est le seul geste
 * de cet écran qui retire les annonces de la diffusion, et un clic malheureux
 * ne doit pas suffire.
 */
export function SubscriptionActions({
  state,
  endsAt,
}: {
  state: 'none' | 'active' | 'cancelled';
  /** Date de fin effective, affichée dans la confirmation de résiliation. */
  endsAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async (action: Action) => {
    setBusy(action);
    setError(null);
    try {
      if (action === 'subscribe') await subscribe();
      else if (action === 'cancel') await cancelSubscription();
      else await resumeSubscription();
      setConfirming(false);
      router.refresh();
    } catch (failure) {
      setError(failure as ApiFailure);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {error ? (
        <div className="auth__error mb-12" role="alert">
          {error.message}
        </div>
      ) : null}

      {state === 'none' ? (
        <button
          type="button"
          className="btn btn-block"
          onClick={() => run('subscribe')}
          disabled={busy !== null}
        >
          {busy === 'subscribe' ? 'Souscription…' : 'Souscrire l’abonnement'}
        </button>
      ) : null}

      {state === 'active' ? (
        confirming ? (
          <>
            <p className="p-sm mb-12">
              À confirmer : vos annonces sortent de la diffusion
              {endsAt ? ` le ${endsAt}` : ' à la fin de la période en cours'}. Les baux
              déjà signés restent accessibles.
            </p>
            <div className="flex gap-10 wrap">
              <button
                type="button"
                className="btn btn--ghost btn-sm"
                onClick={() => run('cancel')}
                disabled={busy !== null}
              >
                {busy === 'cancel' ? 'Résiliation…' : 'Confirmer la résiliation'}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => setConfirming(false)}
                disabled={busy !== null}
              >
                Annuler
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn-block mt-12"
            onClick={() => setConfirming(true)}
          >
            Résilier l’abonnement
          </button>
        )
      ) : null}

      {state === 'cancelled' ? (
        <button
          type="button"
          className="btn btn-block mt-12"
          onClick={() => run('resume')}
          disabled={busy !== null}
        >
          {busy === 'resume' ? 'Reprise…' : 'Reprendre l’abonnement'}
        </button>
      ) : null}
    </>
  );
}
