'use client';
import { useEffect, useState } from 'react';
import { operationsRequest, ERASURE_LABELS, type OperationsView } from '@/lib/operations-client';

const EVENT_LABELS: Record<string, string> = {
  MFA_SETUP_STARTED: 'Configuration du second facteur',
  MFA_ENABLED: 'Second facteur activé',
  MFA_VERIFIED: 'Second facteur validé',
  MFA_REJECTED: 'Code du second facteur refusé',
  MFA_RECOVERY_USED: 'Code de secours utilisé',
  ERASURE_REQUESTED: 'Suppression demandée',
  ERASURE_STARTED: 'Effacement commencé',
  ERASURE_HELD: 'Conservation à examiner',
  ERASURE_COMPLETED: 'Effacement terminé',
  INCIDENT_ACKNOWLEDGED: 'Incident pris en charge',
};
export function OperationsScreen() {
  const [view, setView] = useState<OperationsView | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const refresh = async () => setView(await operationsRequest<OperationsView>('/admin/operations'));
  async function retry() {
    setPending(true);
    setError('');
    try { await refresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  useEffect(() => {
    operationsRequest<OperationsView>('/admin/operations')
      .then(setView)
      .catch((error) => setError(error.message));
  }, []);
  async function act(path: string, payload: unknown) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await operationsRequest(path, payload);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="page operation-page">
      <span className="label label--accent">Administration</span>
      <h1 className="d2 mt-12">Exploitation et données</h1>
      <p className="p mt-12">
        Suivez les incidents et les demandes de suppression. Les décisions sont consignées dans le
        journal de sécurité.
      </p>
      {error ? (
        <p role="alert" className="auth__error mt-16">
          {error}
        </p>
      ) : null}
      {!view ? (
        error ? <button className="btn mt-16" onClick={retry} disabled={pending}>Réessayer</button>
          : <p className="p mt-24" role="status">Chargement du suivi…</p>
      ) : (
        <>
          <div className="panel pad mt-24">
            <h2 className="h">Traitements à surveiller</h2>
            <p className="p mt-12">
              {view.failedMail} e-mail(s) en échec · {view.staleAnalysis} analyse(s) dont le délai
              de traitement est dépassé.
            </p>
            <p className="p-sm mt-8">
              Les alertes externes et la réception des e-mails doivent être vérifiées en
              préproduction.
            </p>
          </div>
          <section className="mt-32">
            <h2 className="h">Demandes de suppression en cours</h2>
            <p className="p-sm mt-8">
              L’effacement ferme définitivement le compte et retire ses documents. Il est réservé
              aux comptes sans engagement. Pour les autres, indiquez les données conservées, le
              motif et la prochaine date de revue.
            </p>
            {view.requests.length === 0 ? (
              <p className="p mt-16">Aucune demande.</p>
            ) : (
              view.requests.map((request) => (
                <article className="panel pad mt-16" key={request.id}>
                  <h3 className="h">{request.accountLabel ?? request.userId}</h3>
                  <p className="p-sm mt-8">
                    {new Date(request.createdAt).toLocaleDateString('fr-FR')} ·{' '}
                    {ERASURE_LABELS[request.status] ?? request.status}
                  </p>
                  {request.reviewNote ? <p className="p mt-12">{request.reviewNote}</p> : null}
                  {request.status !== 'COMPLETED' ? (
                    <>
                      <label className="field mt-16">
                        <span className="label">Motif et suite donnée</span>
                        <textarea
                          className="field__box"
                          maxLength={1000}
                          value={notes[request.id] ?? ''}
                          onChange={(event) =>
                            setNotes((previous) => ({
                              ...previous,
                              [request.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="flex gap-12 wrap mt-16">
                        <button
                          className="btn btn--ghost"
                          disabled={
                            pending || !notes[request.id]?.trim() || request.status === 'ERASING'
                          }
                          onClick={() =>
                            act('/admin/operations/erasure/' + request.id, {
                              action: 'HOLD',
                              note: notes[request.id],
                            })
                          }
                        >
                          Consigner l’examen
                        </button>
                        <button
                          className="btn"
                          disabled={pending || !notes[request.id]?.trim()}
                          onClick={() =>
                            act('/admin/operations/erasure/' + request.id, {
                              action: 'ERASE',
                              note: notes[request.id],
                            })
                          }
                        >
                          {request.status === 'ERASING'
                            ? 'Reprendre l’effacement'
                            : 'Effacer le compte sans engagement'}
                        </button>
                      </div>
                    </>
                  ) : null}
                </article>
              ))
            )}
          </section>
          <section className="mt-32">
            <h2 className="h">Incidents serveur</h2>
            {view.incidents.length === 0 ? (
              <p className="p mt-16">Aucun incident enregistré.</p>
            ) : (
              view.incidents.map((incident) => (
                <article className="panel pad mt-16" key={incident.fingerprint}>
                  <h3 className="h">
                    {incident.category} · {incident.count} occurrence(s)
                  </h3>
                  <p className="p-sm mt-8" style={{ overflowWrap: 'anywhere' }}>
                    {incident.route} · Référence {incident.requestId}
                  </p>
                  <p className="p-sm mt-8">
                    Dernière occurrence : {new Date(incident.lastSeenAt).toLocaleString('fr-FR')}
                  </p>
                  {incident.acknowledgedAt ? (
                    <p className="p-sm mt-8">Pris en charge</p>
                  ) : (
                    <button
                      className="btn btn--ghost mt-12"
                      disabled={pending}
                      onClick={() =>
                        act(
                          '/admin/operations/incidents/' + incident.fingerprint + '/acknowledge',
                          {},
                        )
                      }
                    >
                      Marquer comme pris en charge
                    </button>
                  )}
                </article>
              ))
            )}
          </section>
          <section className="panel pad mt-32">
            <h2 className="h">Journal de sécurité</h2>
            {view.securityEvents.length === 0 ? <p className="p-sm mt-12">Aucun événement de sécurité enregistré.</p> : null}
            <ul className="mt-16">
              {view.securityEvents.map((event) => (
                <li className="mb-8" key={event.id}>
                  {new Date(event.createdAt).toLocaleString('fr-FR')} ·{' '}
                  {EVENT_LABELS[event.action] ?? event.action}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
