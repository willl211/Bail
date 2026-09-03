'use client';

import Link from 'next/link';
import { useState } from 'react';
import { forgotPassword, resetPassword, type AuthFailure } from '@/lib/auth-client';

/**
 * Demande d'un lien de réinitialisation.
 *
 * L'écran de confirmation est **le même quelle que soit l'adresse saisie**, y
 * compris pour une adresse sans compte. C'est délibéré et cela doit le rester :
 * un message différent ferait de ce formulaire public un moyen de savoir qui
 * est client de Bail. Le texte est donc rédigé au conditionnel — « si un compte
 * existe » — pour ne pas mentir non plus.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (failure) {
      setError(failure as AuthFailure);
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <div className="panel panel--strong pad-lg">
        <span className="label label--accent">Demande enregistrée</span>
        <h1 className="d3 mt-8">Regardez vos e-mails</h1>
        <p className="p-sm mt-12">
          Si un compte existe avec l’adresse <b className="mono">{email}</b>, un lien de
          réinitialisation vient d’y être envoyé.
        </p>
        <p className="field__hint mt-10">
          Le lien est valable une heure et ne sert qu’une fois. Rien ne vous parvient au
          bout de quelques minutes ? Vérifiez vos courriers indésirables, puis
          l’orthographe de l’adresse.
        </p>
        <div className="flex gap-12 wrap mt-20">
          <Link href="/dossier" className="btn btn--ghost">
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel panel--strong pad-lg">
      <span className="label label--accent">Mot de passe oublié</span>
      <h1 className="d3 mt-8">Réinitialiser mon mot de passe</h1>
      <p className="p-sm mt-12">
        Indiquez l’adresse de votre compte. Nous vous enverrons un lien pour en choisir
        un nouveau.
      </p>

      <form className="form mt-20" onSubmit={submit} noValidate>
        <label className="field form__full">
          <span className="label label--ink">Adresse e-mail</span>
          <input
            className="field__box"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {error ? (
          <p className="form__full auth__error" role="alert">
            {error.message}
          </p>
        ) : null}

        <div className="form__full flex gap-12 wrap ai-c">
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Envoi…' : 'M’envoyer un lien'}
          </button>
          <Link href="/dossier" className="link">
            Je me souviens de mon mot de passe
          </Link>
        </div>
      </form>
    </div>
  );
}

/**
 * Choix du nouveau mot de passe depuis le lien reçu.
 *
 * On ne connecte pas l'utilisateur après coup, volontairement : la
 * réinitialisation ferme toutes les sessions, et en rouvrir une aussitôt
 * annulerait la seule protection utile si le compte était détourné. Il se
 * reconnecte, avec le mot de passe qu'il vient de choisir.
 */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;

    if (password !== confirmation) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (failure) {
      setError((failure as AuthFailure).message);
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <div className="panel panel--strong pad-lg">
        <span className="label label--accent">Lien incomplet</span>
        <h1 className="d3 mt-8">Ce lien ne peut pas être utilisé</h1>
        <p className="p-sm mt-12">
          Il lui manque son jeton. Recopiez l’adresse complète depuis votre e-mail, ou
          demandez-en un nouveau.
        </p>
        <Link href="/mot-de-passe-oublie" className="btn mt-20">
          Demander un nouveau lien
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel panel--strong pad-lg">
        <span className="label label--accent">Mot de passe modifié</span>
        <h1 className="d3 mt-8">C’est fait</h1>
        <p className="p-sm mt-12">
          Votre nouveau mot de passe est actif. Par précaution, toutes vos sessions ont
          été fermées : reconnectez-vous sur chacun de vos appareils.
        </p>
        {/* Navigation complète et non `Link` : la session vient d'être fermée,
            et le cache du routeur Next servirait la mise en page telle qu'elle
            était avant — en-tête d'un compte connecté sur une page qui ne l'est
            plus. */}
        <a href="/dossier" className="btn mt-20">
          Se connecter
        </a>
      </div>
    );
  }

  return (
    <div className="panel panel--strong pad-lg">
      <span className="label label--accent">Nouveau mot de passe</span>
      <h1 className="d3 mt-8">Choisissez un nouveau mot de passe</h1>

      <form className="form mt-20" onSubmit={submit} noValidate>
        <label className="field form__full">
          <span className="label label--ink">Nouveau mot de passe</span>
          <input
            className="field__box"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="field__hint">12 caractères minimum.</span>
        </label>

        <label className="field form__full">
          <span className="label label--ink">Confirmation</span>
          <input
            className="field__box"
            type="password"
            required
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>

        {error ? (
          <p className="form__full auth__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form__full">
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <p className="field__hint mt-10">
            L’enregistrement ferme toutes vos sessions ouvertes, ici comme ailleurs.
          </p>
        </div>
      </form>
    </div>
  );
}
