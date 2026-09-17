'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setupMfa, verifyMfa, type AuthFailure } from '@/lib/auth-client';
import { LogoutButton } from './logout-button';

export function MfaScreen({ enrolled }: { enrolled: boolean }) {
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      if (!enrolled && !secret) {
        const result = await setupMfa(password);
        setSecret(result.secret);
        setPassword('');
      } else {
        const result = await verifyMfa(code);
        setCode('');
        setSecret('');
        if (result.recoveryCodes.length) setCodes(result.recoveryCodes);
        else {
          router.replace('/back-office');
          router.refresh();
        }
      }
    } catch (failure) {
      setError((failure as AuthFailure).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="page">
      <div className="panel pad" style={{ maxWidth: 640, margin: '32px auto' }}>
        <span className="label label--accent">Accès administrateur</span>
        <h1 className="d3 mt-12">Double authentification</h1>
        {codes.length ? (
          <>
            <p className="p mt-16">
              Conservez ces codes de secours dans un endroit sûr. Chacun remplace un code de
              l’application une seule fois. Ils ne seront plus affichés.
            </p>
            <ul className="mt-16" style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
              {codes.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
            <label className="flex gap-8 mt-16">
              <input
                type="checkbox"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
              />
              J’ai conservé mes codes de secours.
            </label>
            <button
              className="btn mt-16"
              disabled={!saved}
              onClick={() => {
                setCodes([]);
                router.replace('/back-office');
                router.refresh();
              }}
            >
              Ouvrir le back-office
            </button>
          </>
        ) : (
          <form className="form mt-24" onSubmit={submit}>
            {!enrolled && !secret ? (
              <>
                <p className="p">
                  Ajoutez whoma dans votre application d’authentification. Confirmez d’abord votre
                  mot de passe pour démarrer.
                </p>
                <label className="field">
                  <span className="label">Mot de passe actuel</span>
                  <input
                    className="field__box"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                {secret ? (
                  <div className="wash pad">
                    <p className="p-sm">
                      Dans votre application, ajoutez une clé manuellement : nom « whoma », type
                      basé sur le temps, 6 chiffres, période de 30 secondes.
                    </p>
                    <code style={{ display: 'block', overflowWrap: 'anywhere', marginTop: 12 }}>
                      {secret}
                    </code>
                    <p className="p-sm mt-8">Cette configuration expire après 10 minutes.</p>
                  </div>
                ) : null}
                <label className="field">
                  <span className="label">
                    {enrolled
                      ? 'Code de l’application ou code de secours'
                      : 'Code à 6 chiffres de l’application'}
                  </span>
                  <input
                    className="field__box"
                    autoComplete="one-time-code"
                    required
                    minLength={6}
                    maxLength={64}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
              </>
            )}
            {error ? (
              <p role="alert" className="auth__error">
                {error}
              </p>
            ) : null}
            <button className="btn" disabled={pending}>
              {pending
                ? 'Vérification…'
                : !enrolled && !secret
                  ? 'Configurer mon application'
                  : 'Valider le code'}
            </button>
          </form>
        )}
        <div className="flex gap-16 mt-24">
          <LogoutButton />
          <Link className="link" href="/">
            Accueil
          </Link>
        </div>
      </div>
    </main>
  );
}
