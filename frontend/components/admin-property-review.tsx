'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminPropertyRow } from '@/lib/api';
import { decideProperty, decidePropertyDocument, type AdminFailure } from '@/lib/admin-client';
import * as fmt from '@/lib/format';
import { AdminDocumentReview, DIAGNOSTIC_LABELS } from './admin-document-review';

const STATUS: Record<string, string> = {
  DRAFT: 'À corriger',
  PENDING_REVIEW: 'À contrôler',
  ONLINE: 'En ligne',
  VISITS_IN_PROGRESS: 'En visite',
  RENTED: 'Loué',
  ARCHIVED: 'Archivé',
};

export function AdminPropertyReview({
  properties,
  onChange,
}: {
  properties: AdminPropertyRow[];
  onChange: (rows: AdminPropertyRow[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<AdminFailure | null>(null);
  const [selected, setSelected] = useState(
    properties.find((property) => property.status === 'PENDING_REVIEW')?.reference ??
      properties[0]?.reference,
  );
  const query = search.trim().toLocaleLowerCase('fr');
  const visible = properties
    .filter(
      (property) =>
        (filter === 'all' || property.status === filter) &&
        `${property.reference} ${property.title} ${property.ownerName} ${property.addressLine}`
          .toLocaleLowerCase('fr')
          .includes(query),
    )
    .sort((a, b) => Number(b.status === 'PENDING_REVIEW') - Number(a.status === 'PENDING_REVIEW'));
  const property = visible.find((row) => row.reference === selected) ?? visible[0];
  return (
    <div className="admin-property-review">
      <aside className="admin-property-review__list">
        <div className="admin-property-review__filters">
          <h2 className="h-sm">Biens et diagnostics</h2>
          <label className="field mt-16">
            <span className="label">Rechercher un bien</span>
            <input
              className="field__box"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Référence, adresse, propriétaire…"
            />
          </label>
          <label className="field mt-8">
            <span className="label">État de l’annonce</span>
            <select
              className="field__box"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">Tous les biens ({properties.length})</option>
              <option value="PENDING_REVIEW">À contrôler</option>
              <option value="DRAFT">Renvoyés au propriétaire</option>
              <option value="ONLINE">En ligne</option>
            </select>
          </label>
        </div>
        <nav aria-label="Bien à contrôler">
          {visible.map((row) => (
            <button
              key={row.reference}
              type="button"
              className="admin-property-review__pick"
              aria-current={row.reference === property?.reference ? 'true' : undefined}
              onClick={() => setSelected(row.reference)}
            >
              <span className="label">
                {row.reference} · {STATUS[row.status]}
              </span>
              <strong>{row.title}</strong>
              <span>{row.ownerName}</span>
              <small>
                {row.documents.length} diagnostic{row.documents.length > 1 ? 's' : ''} ·{' '}
                {row.blockers.length ? 'Contrôle à compléter' : 'Conditions remplies'}
              </small>
            </button>
          ))}
        </nav>
        {!visible.length ? (
          <p className="pad p-sm">Aucun bien ne correspond à cette recherche.</p>
        ) : null}
      </aside>
      <div>
        {error ? (
          <div className="auth__error pad" role="alert">
            {error.message}
          </div>
        ) : null}
        {property ? (
          <PropertyControl
            key={`${property.reference}:${property.revision}`}
            property={property}
            onChange={(rows) => {
              setError(null);
              onChange(rows);
            }}
            onError={setError}
          />
        ) : (
          <div className="admin-review-empty">
            Les annonces transmises par les propriétaires apparaîtront ici.
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyControl({
  property,
  onChange,
  onError,
}: {
  property: AdminPropertyRow;
  onChange: (rows: AdminPropertyRow[]) => void;
  onError: (error: AdminFailure) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'PUBLISH' | 'REJECT') => {
    setBusy(true);
    try {
      onChange(await decideProperty(property.reference, decision, property.revision, reason));
      router.refresh();
    } catch (failure) {
      onError(failure as AdminFailure);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="admin-property-review__detail"
      aria-label={`Contrôle du bien ${property.reference}`}
    >
      <header className="admin-property-review__head">
        <span className="label label--accent">
          {property.reference} · Version {property.revision} · {STATUS[property.status]}
        </span>
        <h2 className="h mt-8">{property.title}</h2>
        <p className="p-sm mt-8">
          {property.addressLine} · {property.district}
        </p>
        <p className="doc__m mt-8">
          {property.ownerName} · {fmt.surfaceLower(property.surfaceM2)} ·{' '}
          {fmt.euros(property.totalRentCents)} CC · Classe DPE déclarée :{' '}
          {property.energyRating ?? 'absente'}
        </p>
        <p className="doc__m">
          {property.savedCount} sauvegarde{property.savedCount > 1 ? 's' : ''}
        </p>
      </header>
      <AdminDocumentReview
        documents={property.documents.map((doc) => ({
          ...doc,
          label: DIAGNOSTIC_LABELS[doc.type] ?? doc.type,
        }))}
        kind="property"
        revision={property.revision}
        readOnly={property.status !== 'PENDING_REVIEW'}
        onBusy={setBusy}
        onError={onError}
        onDecision={async (id, review) =>
          onChange(await decidePropertyDocument(id, property.revision, review))
        }
      />
      <div className="admin-property-review__publication">
        <h3 className="h-sm">Décision sur l’annonce</h3>
        {property.reviewNote ? (
          <p className="document-review__note">Renvoi au propriétaire : {property.reviewNote}</p>
        ) : null}
        {property.blockers.length ? (
          <ul className="checklist mt-12">
            {property.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : (
          <p className="p-sm mt-12">Les conditions de publication sont remplies.</p>
        )}
        {property.warnings.length ? (
          <p className="field__hint mt-8">Conseils : {property.warnings.join(' · ')}</p>
        ) : null}
        {property.status === 'PENDING_REVIEW' ? (
          <>
            <button
              type="button"
              className="btn mt-16"
              disabled={busy || property.blockers.length > 0}
              title={property.blockers.length ? property.blockers.join(' · ') : undefined}
              onClick={() => decide('PUBLISH')}
            >
              Publier ce bien
            </button>
            <label className="field mt-24">
              <span className="label label--ink">Motif de renvoi au propriétaire</span>
              <textarea
                className="field__box"
                rows={2}
                maxLength={400}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Précisez les corrections nécessaires sur les pièces ou l’annonce."
              />
            </label>
            <p className="field__hint mt-8">
              Le renvoi permet au propriétaire de corriger l’annonce et de remplacer les diagnostics
              refusés.
            </p>
            <button
              type="button"
              className="btn btn--ghost btn-sm mt-12"
              disabled={busy || !reason.trim()}
              onClick={() => decide('REJECT')}
            >
              Renvoyer pour correction
            </button>
          </>
        ) : null}
      </div>
      <details className="admin-property-review__history">
        <summary>Historique du contrôle ({property.history.length})</summary>
        {property.history.length ? (
          <ol className="admin-review-history">
            {property.history.map((event, index) => (
              <li key={`${event.at}:${index}`}>
                <span className="label">{fmt.relativeAge(event.at)}</span>
                <strong>{event.title}</strong>
                <p>{event.note}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="p-sm mt-12">Aucune décision enregistrée pour ce bien.</p>
        )}
      </details>
    </section>
  );
}
