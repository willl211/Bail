'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  deleteDocument,
  documentFileUrl,
  uploadDocument,
  type ApiFailure,
  type PropertyDocumentType,
} from '@/lib/owner-client';

interface PropertyDocument {
  id: string;
  type: PropertyDocumentType;
  status: string;
  fileName: string | null;
  fileSize: number | null;
  issuedAt: string | null;
  rejectionReason: string | null;
}

/**
 * Diagnostics attendus, dans l'ordre où la maquette les présente.
 *
 * Seul le DPE est marqué obligatoire : c'est le seul dont l'absence empêche de
 * diffuser une annonce de location. Les autres dépendent du bien (année de
 * construction, présence de gaz, zone) — les exiger tous bloquerait des dépôts
 * légitimes.
 */
const EXPECTED: {
  type: PropertyDocumentType;
  label: string;
  hint: string;
  required?: boolean;
}[] = [
  {
    type: 'DPE',
    label: 'Diagnostic de performance énergétique',
    hint: 'Obligatoire pour diffuser l’annonce.',
    required: true,
  },
  { type: 'ASBESTOS', label: 'Amiante', hint: 'Immeubles construits avant 1997.' },
  { type: 'LEAD', label: 'Plomb (CREP)', hint: 'Immeubles construits avant 1949.' },
  { type: 'ERP', label: 'État des risques et pollutions', hint: 'Selon la commune.' },
  { type: 'ELECTRICAL', label: 'Installation électrique', hint: 'Si elle a plus de 15 ans.' },
  { type: 'GAS', label: 'Installation gaz', hint: 'Si elle a plus de 15 ans.' },
];

const STATUS_TONE: Record<string, string> = {
  VERIFIED: 'badge badge--ok',
  PENDING: 'badge badge--pending',
  PROCESSING: 'badge badge--pending',
  REJECTED: 'badge badge--reject',
  EXPIRED: 'badge badge--reject',
};

const STATUS_LABEL: Record<string, string> = {
  VERIFIED: 'Vérifié',
  PENDING: 'À contrôler',
  PROCESSING: 'Contrôle en cours',
  REJECTED: 'Refusé',
  EXPIRED: 'Expiré',
};

/** Affiche les octets sous 1 Ko : « 0 Ko » donnerait l'air d'un fichier vide. */
const formatSize = (bytes: number | null) => {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
};

const formatDate = (iso: string | null) =>
  iso === null ? null : new Date(iso).toLocaleDateString('fr-FR');

const MAX_BYTES = 15 * 1024 * 1024;

export function DiagnosticsUploader({
  reference,
  documents,
  readOnly,
}: {
  reference: string | null;
  documents: PropertyDocument[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busy, setBusy] = useState<PropertyDocumentType | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);

  if (!reference) {
    return (
      <div className="panel" style={{ padding: '19px 20px' }}>
        <p className="p-sm">
          Enregistrez d’abord le brouillon : les diagnostics ont besoin d’une référence
          de bien à laquelle se rattacher.
        </p>
      </div>
    );
  }

  const onFile = async (type: PropertyDocumentType, file: File | undefined) => {
    if (!file) return;
    setBusy(type);
    setError(null);

    try {
      if (file.size > MAX_BYTES) {
        throw {
          message: `« ${file.name} » dépasse 15 Mo.`,
        } satisfies ApiFailure;
      }
      await uploadDocument(reference, type, file);
      router.refresh();
    } catch (failure) {
      setError(failure as ApiFailure);
    } finally {
      setBusy(null);
      const input = inputs.current[type];
      if (input) input.value = '';
    }
  };

  const onRemove = async (type: PropertyDocumentType, documentId: string) => {
    setBusy(type);
    setError(null);
    try {
      await deleteDocument(reference, documentId);
      router.refresh();
    } catch (failure) {
      setError(failure as ApiFailure);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      {EXPECTED.map((expected) => {
        const document = documents.find((entry) => entry.type === expected.type);
        const pending = busy === expected.type;

        return (
          <div key={expected.type} className="doc-row">
            <div>
              <div className="doc-row__name">
                {expected.label}
                {expected.required ? <span className="doc-row__required">requis</span> : null}
              </div>
              <div className="doc-row__meta">
                {document
                  ? [
                      document.fileName,
                      formatSize(document.fileSize),
                      formatDate(document.issuedAt)
                        ? `réalisé le ${formatDate(document.issuedAt)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : expected.hint}
              </div>
              {document?.rejectionReason ? (
                <div className="doc-row__meta" style={{ color: 'var(--reject)' }}>
                  {document.rejectionReason}
                </div>
              ) : null}
            </div>

            <div className="doc-row__actions">
              {document ? (
                <>
                  <span className={STATUS_TONE[document.status] ?? 'badge badge--mute'}>
                    {STATUS_LABEL[document.status] ?? document.status}
                  </span>
                  <a
                    className="link"
                    href={documentFileUrl(reference, document.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir
                  </a>
                </>
              ) : (
                <span className="badge badge--mute">Absent</span>
              )}

              {!readOnly ? (
                <>
                  <button
                    type="button"
                    className="btn btn--ghost btn-sm"
                    onClick={() => inputs.current[expected.type]?.click()}
                    disabled={pending}
                  >
                    {pending ? 'Envoi…' : document ? 'Remplacer' : 'Déposer'}
                  </button>
                  {document ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => onRemove(expected.type, document.id)}
                      disabled={pending}
                    >
                      Retirer
                    </button>
                  ) : null}
                  <input
                    ref={(element) => {
                      inputs.current[expected.type] = element;
                    }}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(event) => onFile(expected.type, event.target.files?.[0])}
                  />
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      <div style={{ padding: '14px 18px' }}>
        {error ? (
          <div className="auth__error mb-12" role="alert">
            {error.message}
          </div>
        ) : null}
        <p className="field__hint">
          PDF ou image · 15 Mo maximum. Ces pièces ne sont pas publiques : elles sont
          annexées au bail et consultables par vous, l’agent qui contrôle l’annonce et
          le locataire signataire.
        </p>
      </div>
    </div>
  );
}
