'use client';
import { useEffect, useState } from 'react';
import { operationsRequest, ERASURE_LABELS, type ErasureView } from '@/lib/operations-client';

export function PrivacyScreen() {
  const [request, setRequest] = useState<ErasureView | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    operationsRequest<ErasureView | null>('/privacy/erasure')
      .then((value) => { setRequest(value); setLoaded(true); })
      .catch((error) => setError(error.message));
  }, []);
  async function retry() {
    setPending(true);
    setError('');
    try {
      setRequest(await operationsRequest<ErasureView | null>('/privacy/erasure'));
      setLoaded(true);
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      setRequest(await operationsRequest<ErasureView>('/privacy/erasure', { password }));
      setPassword('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="page">
      <div className="panel pad" style={{ maxWidth: 680, margin: '32px auto' }}>
        <span className="label label--accent">Vie privée</span>
        <h1 className="d3 mt-12">Mes données</h1>
        <p className="p mt-16">
          Vous pouvez demander la suppression de votre compte et de vos données. L’équipe vérifie
          les opérations en cours et les obligations de conservation avant d’agir.
        </p>
        {!loaded ? (
          error ? <button className="btn mt-16" onClick={retry} disabled={pending}>Réessayer</button>
            : <p className="p mt-16" role="status">Chargement de votre demande…</p>
        ) : request ? (
          <div className="wash pad mt-24">
            <h2 className="h">{ERASURE_LABELS[request.status] ?? request.status}</h2>
            <p className="p-sm mt-8">
              Demande du {new Date(request.createdAt).toLocaleDateString('fr-FR')}
            </p>
            {request.reviewNote ? <p className="p mt-12">{request.reviewNote}</p> : null}
          </div>
        ) : (
          <form className="form mt-24" onSubmit={submit}>
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
            <button className="btn" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Demander la suppression'}
            </button>
          </form>
        )}
        {error ? (
          <p className="auth__error mt-16" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
