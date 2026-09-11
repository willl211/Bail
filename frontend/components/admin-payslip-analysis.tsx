'use client';

import { useEffect, useState } from 'react';
import { getPayslipAnalysis, requestPayslipAnalysis, type AdminFailure } from '@/lib/admin-client';
import type { PayslipAnalysisView, PayslipFieldKey } from '@/lib/payslip-analysis';

const LABELS: Record<PayslipFieldKey, string> = {
  employeeName: 'Salarié',
  employerName: 'Employeur',
  periodStart: 'Début de période',
  periodEnd: 'Fin de période',
  netBeforeTaxCents: 'Net avant impôt',
  netPaidCents: 'Net payé',
  netTaxableCents: 'Net imposable mensuel',
};
const STATES = {
  NOT_REQUESTED: 'Pas encore analysé',
  UNAVAILABLE: 'Analyse non activée',
  QUEUED: 'En attente',
  PROCESSING: 'Lecture en cours',
  COMPLETED: 'Lecture disponible',
  FAILED: 'Lecture à reprendre',
};

export function AdminPayslipAnalysis({
  documentId,
  revision,
}: {
  documentId: string;
  revision: number;
}) {
  const [data, setData] = useState<PayslipAnalysisView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await getPayslipAnalysis(documentId, revision, controller.signal);
        if (controller.signal.aborted) return;
        setData(next);
        setError('');
        if (
          next.configured &&
          (['QUEUED', 'PROCESSING'].includes(next.status) ||
            (['FAILED', 'UNAVAILABLE'].includes(next.status) && next.retryAfterSeconds > 0))
        )
          timer = setTimeout(read, 5000);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError((failure as AdminFailure).message ?? 'Impossible de charger l’analyse.');
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [documentId, revision, reload]);

  async function launch() {
    setBusy(true);
    setError('');
    try {
      setData(await requestPayslipAnalysis(documentId, revision));
      setReload((value) => value + 1);
    } catch (failure) {
      setError((failure as AdminFailure).message ?? 'Impossible de lancer l’analyse.');
    } finally {
      setBusy(false);
    }
  }
  const fields = data?.extraction?.kind === 'PAYSLIP' ? data.extraction : null;
  const value = (key: PayslipFieldKey) => {
    const read = fields?.[key].value;
    if (read === null || read === undefined) return 'Non lu';
    if (key.endsWith('Cents') && typeof read === 'number')
      return (read / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    if (key.startsWith('period') && typeof read === 'string')
      return new Date(read).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
    return String(read);
  };
  return (
    <section className="payslip-analysis" aria-label="Aide IA à la lecture du bulletin">
      <div className="payslip-analysis__heading">
        <h4>
          Aide à la lecture <span>IA</span>
        </h4>
        <span className="payslip-analysis__status" role="status">
          {data ? STATES[data.status] : error ? 'Indisponible' : 'Chargement…'}
        </span>
      </div>
      <p>Lecture automatique à confirmer sur la pièce. La validation reste votre décision.</p>
      {data?.message ? <p className="payslip-analysis__message">{data.message}</p> : null}
      {error ? (
        <p className="auth__error" role="alert">
          {error}
        </p>
      ) : null}
      {fields ? (
        <>
          <dl className="payslip-analysis__fields">
            {(Object.keys(LABELS) as PayslipFieldKey[]).map((key) => (
              <div key={key}>
                <dt>{LABELS[key]}</dt>
                <dd>{value(key)}</dd>
              </div>
            ))}
          </dl>
          <details className="payslip-analysis__evidence">
            <summary>Voir les passages lus dans le document</summary>
            <ul>
              {(Object.keys(LABELS) as PayslipFieldKey[])
                .filter((key) => fields[key].evidence)
                .map((key) => (
                  <li key={key}>
                    <strong>
                      {LABELS[key]} · page {fields[key].page}
                    </strong>
                    <q>{fields[key].evidence}</q>
                  </li>
                ))}
            </ul>
          </details>
        </>
      ) : null}
      {data?.checks.length ? (
        <div className="payslip-analysis__checks">
          <h5>Points de contrôle</h5>
          <ul>
            {data.checks.map((check) => (
              <li key={check.code} data-tone={check.tone}>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data?.completedAt ? (
        <p className="payslip-analysis__date">
          Lecture du {new Date(data.completedAt).toLocaleString('fr-FR')} · ne certifie pas
          l’authenticité du document.
        </p>
      ) : null}
      {data?.configured && ['NOT_REQUESTED', 'UNAVAILABLE', 'FAILED'].includes(data.status) ? (
        <>
          <button
            type="button"
            className="btn btn--ghost btn-sm"
            disabled={busy || !data.canRequest}
            onClick={launch}
          >
            {busy
              ? 'Demande en cours…'
              : data.status === 'FAILED'
                ? 'Relancer la lecture'
                : 'Analyser ce bulletin'}
          </button>
          {data.retryAfterSeconds > 0 ? (
            <small>Une relance sera disponible dans moins d’une minute.</small>
          ) : null}
        </>
      ) : null}
      {error ? (
        <button type="button" className="link" onClick={() => setReload((value) => value + 1)}>
          Actualiser l’analyse
        </button>
      ) : null}
    </section>
  );
}
