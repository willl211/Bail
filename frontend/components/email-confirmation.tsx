'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { confirmEmail, resendVerification, type AuthFailure } from '@/lib/auth-client';

type State =
  | { step: 'pending' }
  | { step: 'done'; email: string }
  | { step: 'failed'; message: string };

/**
 * Confirmation d'adresse depuis le lien reçu par e-mail.
 *
 * La confirmation part dès l'affichage plutôt que derrière un bouton : le
 * destinataire a déjà cliqué une fois, dans son courrier. Lui redemander de
 * confirmer sa confirmation n'apporte rien.
 *
 * Le jeton n'est pas conservé après usage — ni dans l'URL affichée, ni dans
 * l'historique du navigateur : il est retiré de la barre d'adresse dès qu'il a
 * servi, pour qu'un lien copié depuis l'historique ne circule pas.
 */
export function EmailConfirmation({ token }: { token: string | null }) {
  const [state, setState] = useState<State>(
    token ? { step: 'pending' } : { step: 'failed', message: 'Ce lien est incomplet.' },
  );
  const [resent, setResent] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    // React monte deux fois en développement : sans ce garde, le jeton — à
    // usage unique — serait consommé au premier appel et l'écran afficherait
    // l'échec du second.
    started.current = true;

    confirmEmail(token)
      .then((result) => {
        setState({ step: 'done', email: result.email });
        window.history.replaceState(null, '', '/verification-email');
      })
      .catch((failure: AuthFailure) =>
        setState({ step: 'failed', message: failure.message }),
      );
  }, [token]);

  const resend = async () => {
    setResent('sending');
    setResendError(null);
    try {
      await resendVerification();
      setResent('sent');
    } catch (failure) {
      setResent('error');
      setResendError((failure as AuthFailure).message);
    }
  };

  return (
    <div className="page page--narrow">
      <div className="panel panel--strong pad-lg">
        {state.step === 'pending' ? (
          <>
            <span className="label label--accent">Confirmation en cours</span>
            <h1 className="d3 mt-8">Un instant…</h1>
            <p className="p-sm mt-12">Nous vérifions votre lien.</p>
          </>
        ) : null}

        {state.step === 'done' ? (
          <>
            <span className="label label--accent">Adresse confirmée</span>
            <h1 className="d3 mt-8">C’est fait</h1>
            <p className="p-sm mt-12">
              <b className="mono">{state.email}</b> est confirmée. C’est par elle que
              passeront les décisions qui vous concernent — candidature retenue, pièce à
              corriger, rendez-vous de visite.
            </p>
            {/* Navigation complète : le rappel « adresse à confirmer » est
                rendu côté serveur, et le cache du routeur Next le rejouerait
                tel quel alors que l'adresse vient d'être confirmée. */}
            <div className="flex gap-12 wrap mt-20">
              <a href="/dossier" className="btn">
                Aller à mon dossier
              </a>
              <a href="/recherche" className="btn btn--ghost">
                Voir les biens
              </a>
            </div>
          </>
        ) : null}

        {state.step === 'failed' ? (
          <>
            <span className="label label--accent">Lien expiré</span>
            <h1 className="d3 mt-8">Ce lien n’est plus valable</h1>
            <p className="p-sm mt-12">{state.message}</p>
            <p className="field__hint mt-10">
              Un lien de confirmation vaut 24 heures et ne sert qu’une fois. Si vous
              êtes connecté, vous pouvez en demander un nouveau ci-dessous ; sinon,
              connectez-vous d’abord.
            </p>

            {resent === 'sent' ? (
              <p className="p-sm mt-16">
                <span className="badge badge--ok">Envoyé</span> Un nouveau lien vient de
                partir. Pensez à regarder vos courriers indésirables.
              </p>
            ) : (
              <div className="flex gap-12 wrap mt-20">
                <button
                  type="button"
                  className="btn"
                  onClick={resend}
                  disabled={resent === 'sending'}
                >
                  {resent === 'sending' ? 'Envoi…' : 'M’envoyer un nouveau lien'}
                </button>
                <Link href="/dossier" className="btn btn--ghost">
                  Se connecter
                </Link>
              </div>
            )}

            {resendError ? (
              <p className="auth__error mt-16" role="alert">
                {resendError}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
