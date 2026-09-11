'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadAdminDocument, type AdminFailure, type DiagnosticReview } from '@/lib/admin-client';
import { AdminPayslipAnalysis } from './admin-payslip-analysis';

export const DIAGNOSTIC_LABELS: Record<string, string> = {
  DPE: 'Diagnostic de performance énergétique',
  ASBESTOS: 'Amiante',
  LEAD: 'Plomb (CREP)',
  ERP: 'État des risques et pollutions',
  ELECTRICAL: 'Installation électrique',
  GAS: 'Installation gaz',
  OTHER: 'Autre diagnostic',
};

const STATUS: Record<string, { label: string; tone: string }> = {
  MISSING: { label: 'Absent', tone: 'mute' },
  PENDING: { label: 'À contrôler', tone: 'pending' },
  PROCESSING: { label: 'En cours', tone: 'pending' },
  VERIFIED: { label: 'Vérifié', tone: 'ok' },
  REJECTED: { label: 'Refusé', tone: 'reject' },
  EXPIRED: { label: 'Expiré', tone: 'reject' },
};

export interface ReviewDocument {
  id: string;
  label: string;
  type?: string;
  status: string;
  fileName: string | null;
  hasFile: boolean;
  note: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
}

/** Le parent fournit une clé référence/version : une nouvelle version ferme l'ancienne pièce. */
export function AdminDocumentReview({
  documents,
  kind,
  revision,
  readOnly = false,
  onDecision,
  onBusy,
  onError,
}: {
  documents: ReviewDocument[];
  kind: 'tenant' | 'property';
  revision: number;
  readOnly?: boolean;
  onDecision: (id: string, review: DiagnosticReview) => Promise<void>;
  onBusy?: (busy: boolean) => void;
  onError?: (error: AdminFailure) => void;
}) {
  const [selected, setSelected] = useState(
    documents.find((doc) => ['PENDING', 'PROCESSING'].includes(doc.status))?.id ?? documents[0]?.id,
  );
  const [busy, setBusy] = useState(false);
  const document = documents.find((doc) => doc.id === selected) ?? documents[0];
  if (!document)
    return (
      <p className="admin-review-empty">
        Aucun document déposé. Demandez les pièces manquantes avant de valider.
      </p>
    );

  return (
    <section className="document-review" aria-label="Contrôle des documents">
      <label className="field document-review__selector">
        <span className="label label--ink">
          Document à examiner · {documents.length} pièce{documents.length > 1 ? 's' : ''}
        </span>
        <select
          className="field__box"
          value={document.id}
          disabled={busy}
          onChange={(event) => setSelected(event.target.value)}
        >
          {documents.map((doc) => (
            <option value={doc.id} key={doc.id}>
              {STATUS[doc.status]?.label ?? doc.status} · {doc.label} ·{' '}
              {doc.fileName ?? 'Fichier absent'}
            </option>
          ))}
        </select>
      </label>
      <DocumentControl
        key={document.id}
        document={document}
        kind={kind}
        revision={revision}
        readOnly={readOnly}
        onDecision={onDecision}
        onError={onError}
        onBusy={(value) => {
          setBusy(value);
          onBusy?.(value);
        }}
      />
    </section>
  );
}

function DocumentControl({
  document,
  kind,
  revision,
  readOnly,
  onDecision,
  onBusy,
  onError,
}: {
  document: ReviewDocument;
  kind: 'tenant' | 'property';
  revision: number;
  readOnly: boolean;
  onDecision: (id: string, review: DiagnosticReview) => Promise<void>;
  onBusy?: (busy: boolean) => void;
  onError?: (error: AdminFailure) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [issuedAt, setIssuedAt] = useState(document.issuedAt?.slice(0, 10) ?? '');
  const [expiresAt, setExpiresAt] = useState(document.expiresAt?.slice(0, 10) ?? '');
  const [energyRating, setEnergyRating] = useState('');
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  const open = async () => {
    setLoading(true);
    setError(null);
    request.current = new AbortController();
    try {
      const blob = await loadAdminDocument(kind, document.id, revision, request.current.signal);
      if (request.current.signal.aborted) return;
      url.current = URL.createObjectURL(blob);
      setPreview({ url: url.current, type: blob.type });
    } catch (failure) {
      if (!request.current.signal.aborted)
        setError((failure as AdminFailure).message ?? 'Impossible d’ouvrir le document.');
    } finally {
      setLoading(false);
    }
  };

  const decide = async (decision: 'VERIFY' | 'REJECT') => {
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      await onDecision(document.id, {
        decision,
        reason: reason.trim() || undefined,
        ...(decision === 'VERIFY' && kind === 'property'
          ? {
              issuedAt: issuedAt || undefined,
              expiresAt: expiresAt || undefined,
              energyRating: energyRating || undefined,
            }
          : {}),
      });
      router.refresh();
    } catch (failure) {
      const issue = {
        message: (failure as AdminFailure).message ?? 'La décision n’a pas pu être enregistrée.',
      };
      if (onError) onError(issue);
      else setError(issue.message);
      router.refresh();
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  const status = STATUS[document.status] ?? STATUS.PENDING;
  const dpe = kind === 'property' && document.type === 'DPE';

  return (
    <div className="document-review__body">
      <div className="document-review__preview">
        {preview ? (
          <>
            <div className="document-review__preview-bar">
              <span>Consultation privée</span>
              <a className="link" href={preview.url} target="_blank" rel="noreferrer">
                Ouvrir en grand ↗
              </a>
            </div>
            {preview.type.startsWith('image/') ? (
              // Fichier privé local au navigateur : aucune URL à transmettre à l'optimiseur d'images.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={`${document.label} — ${document.fileName ?? 'Justificatif'}`}
              />
            ) : preview.type === 'application/pdf' ? (
              <object data={preview.url} type="application/pdf" aria-label={document.label}>
                <p>Utilisez « Ouvrir en grand » pour consulter ce PDF.</p>
              </object>
            ) : (
              <p className="pad">
                Aperçu indisponible. Ouvrez le fichier en grand pour le consulter.
              </p>
            )}
          </>
        ) : (
          <div className="document-review__placeholder">
            <span className="document-review__paper" aria-hidden="true">
              {document.type ?? 'DOC'}
            </span>
            <strong>{document.label}</strong>
            <p>{document.fileName ?? 'Aucun fichier associé à cette pièce.'}</p>
            <button
              type="button"
              className="btn btn-sm"
              onClick={open}
              disabled={!document.hasFile || loading}
            >
              {loading ? 'Ouverture…' : 'Consulter le document'}
            </button>
          </div>
        )}
      </div>
      <div className="document-review__decision">
        <div className="flex jc-b ai-c gap-12 wrap">
          <h3 className="h-sm">Contrôle de la pièce</h3>
          <span className={`badge badge--${status.tone}`}>{status.label}</span>
        </div>
        <p className="document-review__filename">{document.fileName ?? 'Fichier indisponible'}</p>
        {document.note ? <p className="document-review__note">{document.note}</p> : null}
        {kind === 'tenant' && document.type === 'PAYSLIP' ? (
          <AdminPayslipAnalysis
            key={`${document.id}:${revision}`}
            documentId={document.id}
            revision={revision}
          />
        ) : null}
        {document.status === 'EXPIRED' ? (
          <p className="document-review__note">
            Ce diagnostic est expiré. Demandez une nouvelle pièce au propriétaire.
          </p>
        ) : null}
        {error ? (
          <div className="auth__error" role="alert">
            {error}
          </div>
        ) : null}
        {readOnly ? (
          <>
            {kind === 'property' ? (
              <dl className="mb-16">
                <div className="kv">
                  <dt className="kv__k">Réalisé le</dt>
                  <dd>
                    {document.issuedAt
                      ? new Date(document.issuedAt).toLocaleDateString('fr-FR', { timeZone: 'UTC' })
                      : 'Non renseigné'}
                  </dd>
                </div>
                <div className="kv">
                  <dt className="kv__k">Valable jusqu’au</dt>
                  <dd>
                    {document.expiresAt
                      ? new Date(document.expiresAt).toLocaleDateString('fr-FR', {
                          timeZone: 'UTC',
                        })
                      : 'Non renseigné'}
                  </dd>
                </div>
              </dl>
            ) : null}
            <p className="p-sm">
              Consultation seule. Les décisions sur les diagnostics se prennent lorsque le bien est
              soumis au contrôle.
            </p>
          </>
        ) : (
          <>
            {kind === 'property' ? (
              <fieldset className="document-review__dates" disabled={busy}>
                <legend>Informations lues sur le diagnostic</legend>
                <label className="field">
                  <span>Réalisé le{dpe ? ' *' : ''}</span>
                  <input
                    className="field__box"
                    type="date"
                    value={issuedAt}
                    onChange={(event) => setIssuedAt(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Valable jusqu’au{dpe ? ' *' : ''}</span>
                  <input
                    className="field__box"
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </label>
                {dpe ? (
                  <label className="field">
                    <span>Classe lue sur le DPE *</span>
                    <select
                      className="field__box"
                      value={energyRating}
                      onChange={(event) => setEnergyRating(event.target.value)}
                    >
                      <option value="">Sélectionner</option>
                      {'ABCDEFG'.split('').map((letter) => (
                        <option key={letter}>{letter}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </fieldset>
            ) : null}
            <label className="document-review__confirm" htmlFor={`${id}-confirm`}>
              <input
                id={`${id}-confirm`}
                type="checkbox"
                checked={confirmed}
                disabled={!preview || busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                J’ai lu cette pièce et vérifié sa cohérence avec les informations déclarées.
              </span>
            </label>
            <button
              type="button"
              className="btn btn-sm"
              disabled={
                busy ||
                !preview ||
                !confirmed ||
                ['VERIFIED', 'EXPIRED'].includes(document.status) ||
                (dpe && (!issuedAt || !expiresAt || !energyRating))
              }
              onClick={() => decide('VERIFY')}
            >
              {busy ? 'Enregistrement…' : 'Valider cette pièce'}
            </button>
            <label className="field mt-16">
              <span className="label label--ink">Motif de refus de cette pièce</span>
              <textarea
                className="field__box"
                rows={2}
                maxLength={400}
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Indiquez précisément ce qui doit être corrigé."
              />
            </label>
            <button
              type="button"
              className="btn btn--ghost btn-sm mt-8"
              disabled={busy || !reason.trim()}
              onClick={() => decide('REJECT')}
            >
              Refuser cette pièce
            </button>
          </>
        )}
      </div>
    </div>
  );
}
