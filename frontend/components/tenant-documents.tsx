'use client';

import { useRef, useState } from 'react';
import type { DocumentStatus, TenantFileView, TenantSlotView } from '@/lib/api';
import {
  deleteDocument,
  documentFileUrl,
  uploadDocument,
  type TenantFailure,
} from '@/lib/tenant-client';

const STATUS: Record<DocumentStatus, { label: string; tone: string }> = {
  MISSING: { label: 'Manquant', tone: 'badge badge--mute' },
  PENDING: { label: 'À contrôler', tone: 'badge badge--pending' },
  PROCESSING: { label: 'Contrôle en cours', tone: 'badge badge--pending' },
  VERIFIED: { label: 'Vérifiée', tone: 'badge badge--ok' },
  REJECTED: { label: 'À remplacer', tone: 'badge badge--reject' },
  EXPIRED: { label: 'Expirée', tone: 'badge badge--reject' },
};

/** Affiche les octets sous 1 Ko : « 0 Ko » donnerait l'air d'un fichier vide. */
const formatSize = (bytes: number | null) => {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/**
 * Liste des pièces attendues.
 *
 * Chaque ligne garde la structure de la maquette — intitulé, verdict du
 * contrôle en monospace, statut — et déplie ses fichiers en dessous. Empiler
 * trois noms de bulletins dans la colonne d'intitulé, comme le faisait la
 * maquette avec son « 3 fichiers », rendait la ligne illisible dès qu'on
 * déposait vraiment trois fichiers.
 */
export function TenantDocuments({
  slots,
  readOnly,
  onChange,
}: {
  slots: TenantSlotView[];
  readOnly: boolean;
  onChange: (view: TenantFileView) => void;
}) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<TenantFailure | null>(null);

  const run = async (key: string, action: () => Promise<TenantFileView>) => {
    setBusy(key);
    setError(null);
    try {
      onChange(await action());
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setBusy(null);
      const input = inputs.current[key];
      if (input) input.value = '';
    }
  };

  const onFile = (slot: TenantSlotView, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError({ message: `« ${file.name} » dépasse 10 Mo.` });
      const input = inputs.current[slot.type];
      if (input) input.value = '';
      return;
    }
    return run(slot.type, () => uploadDocument(slot.type, file));
  };

  return (
    <>
      <div className="panel panel--strong">
        {slots.map((slot) => {
          const pending = busy === slot.type;
          const full = slot.documents.length >= slot.max;
          const verdict =
            slot.documents.find((document) => document.rejectionReason)?.rejectionReason ??
            slot.documents.find((document) => document.verificationNote)
              ?.verificationNote ??
            null;

          return (
            <div key={slot.type} className="doc">
              <div className="doc__head">
                <div>
                  <div className="doc__n">
                    {slot.label}
                    {slot.required ? null : <span className="doc__opt">facultatif</span>}
                  </div>
                  <div className="doc__m">
                    {slot.max > 1
                      ? `${slot.hint} · ${slot.documents.length} / ${slot.max} déposés`
                      : slot.hint}
                  </div>
                </div>

                <div className="doc__c">{verdict ?? '—'}</div>

                <div className="doc__a">
                  <span className={STATUS[slot.status].tone}>
                    {STATUS[slot.status].label}
                  </span>
                  {!readOnly && !full ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--ghost btn-sm"
                        onClick={() => inputs.current[slot.type]?.click()}
                        disabled={pending}
                      >
                        {pending ? 'Envoi…' : 'Déposer'}
                      </button>
                      <input
                        ref={(element) => {
                          inputs.current[slot.type] = element;
                        }}
                        type="file"
                        accept={ACCEPT}
                        hidden
                        onChange={(event) => onFile(slot, event.target.files?.[0])}
                      />
                    </>
                  ) : null}
                </div>
              </div>

              {slot.documents.length > 0 ? (
                <ul className="doc__files">
                  {slot.documents.map((document) => (
                    <li key={document.id} className="doc__file">
                      <span className="doc__filename">
                        {[
                          document.fileName ?? 'Pièce enregistrée',
                          formatSize(document.fileSize),
                          `déposée le ${formatDate(document.uploadedAt)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="doc__fileactions">
                        {/* Pas de lien vers un fichier qui n'existe pas :
                            il ne mènerait qu'à un 404. */}
                        {document.hasFile ? (
                          <a
                            className="link"
                            href={documentFileUrl(document.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Ouvrir
                          </a>
                        ) : null}
                        {readOnly ? null : (
                          <button
                            type="button"
                            className="link"
                            onClick={() =>
                              run(slot.type, () => deleteDocument(document.id))
                            }
                            disabled={pending}
                          >
                            Retirer
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="auth__error mt-12" role="alert">
          {error.message}
        </div>
      ) : null}
    </>
  );
}
