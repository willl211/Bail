'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ApplicationStatus, OwnerApplication, OwnerApplicationsView } from '@/lib/api';
import * as fmt from '@/lib/format';
import { OwnerPropertyPhoto } from './owner-property-photo';
import { ApplicationDecision } from './application-decision';

const STATUS: Record<ApplicationStatus, [string, string]> = {
  SUBMITTED: ['Nouvelle', 'pending'],
  READ: ['Lue', 'mute'],
  SHORTLISTED: ['Retenue', 'ok'],
  VISIT_SCHEDULED: ['Visite planifiée', 'ok'],
  ACCEPTED: ['Acceptée', 'ok'],
  REJECTED: ['Écartée', 'reject'],
  WITHDRAWN: ['Retirée', 'mute'],
  EXPIRED: ['Expirée', 'mute'],
};
const CONTRACT: Record<string, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  PUBLIC_SECTOR: 'Fonction publique',
  SELF_EMPLOYED: 'Indépendant',
  STUDENT: 'Étudiant',
  RETIRED: 'Retraité',
  OTHER: 'Autre',
};
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const href = (reference: string, candidate?: string) =>
  `/proprietaires/candidatures?bien=${encodeURIComponent(reference)}${candidate ? `&candidat=${encodeURIComponent(candidate)}` : ''}`;
const PAGE_SIZE = 8;

function Status({ status }: { status: ApplicationStatus }) {
  return <span className={`badge badge--${STATUS[status][1]}`}>{STATUS[status][0]}</span>;
}

export function OwnerApplications({
  view,
  propertyReference,
  candidateId,
}: {
  view: OwnerApplicationsView;
  propertyReference?: string;
  candidateId?: string;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(1);
  const tile = view.tiles.find((item) => item.reference === propertyReference);
  const rowsByProperty = new Map<string, OwnerApplication[]>();
  for (const row of view.applications) {
    const rows = rowsByProperty.get(row.propertyReference) ?? [];
    rows.push(row);
    rowsByProperty.set(row.propertyReference, rows);
  }
  const freshCount = (reference: string) =>
    (rowsByProperty.get(reference) ?? []).filter((row) => row.status === 'SUBMITTED').length;
  const filtered = view.tiles
    .filter((item) => {
      const matches = normalize(
        `${item.reference} ${item.title} ${item.addressLine} ${item.district}`,
      ).includes(normalize(query.trim()));
      return (
        matches &&
        (scope === 'all' ||
          (scope === 'received' ? item.applicationCount > 0 : freshCount(item.reference) > 0))
      );
    })
    .sort(
      (a, b) =>
        freshCount(b.reference) - freshCount(a.reference) ||
        b.applicationCount - a.applicationCount ||
        a.reference.localeCompare(b.reference),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const rows = tile ? (rowsByProperty.get(tile.reference) ?? []) : [];
  const selected = rows.find((row) => row.id === candidateId) ?? rows[0];

  return (
    <div className="owner-applications">
      <div className="page__head">
        <div>
          <span className="label label--accent">Espace propriétaire</span>
          <h1 className="d3 mt-8">Candidatures</h1>
          <p className="p-sm mt-8">Retrouvez chaque dossier, logement par logement.</p>
        </div>
        <div className="applications-totals">
          <strong>
            {view.newCount}
            <span>nouvelles</span>
          </strong>
          <strong>
            {view.underReviewCount}
            <span>en étude</span>
          </strong>
          <strong>
            {view.visitsScheduledCount}
            <span>visites prévues</span>
          </strong>
        </div>
      </div>

      {!tile ? (
        <>
          {propertyReference ? (
            <p className="reminder">
              Ce bien n’est pas disponible dans votre portefeuille. Sélectionnez un logement
              ci-dessous.
            </p>
          ) : null}
          <div className="applications-toolbar">
            <label className="field">
              <span className="label label--ink">Retrouver un bien</span>
              <input
                className="field__box"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Adresse, quartier, référence…"
              />
            </label>
            <label className="field">
              <span className="label label--ink">Afficher</span>
              <select
                className="field__box"
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Tous mes biens</option>
                <option value="received">Avec des candidatures</option>
                <option value="new">Avec de nouvelles candidatures</option>
              </select>
            </label>
          </div>
          <div className="applications-list-label">
            <span>
              {filtered.length} bien{filtered.length > 1 ? 's' : ''}
            </span>
            <span>Les nouvelles candidatures en premier</span>
          </div>
          <div className="applications-properties">
            {filtered
              .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
              .map((item) => (
                <Link
                  href={href(item.reference)}
                  key={item.reference}
                  className="applications-property"
                >
                  <OwnerPropertyPhoto src={item.photoUrl} title={item.title} />
                  <div className="applications-property__identity">
                    <span className="label">
                      {item.reference} · {item.district}
                    </span>
                    <h2>{item.title}</h2>
                    <p>{item.addressLine || 'Adresse à renseigner'}</p>
                    <span className="applications-property__specs">
                      {item.rooms} pièce{item.rooms > 1 ? 's' : ''} ·{' '}
                      {fmt.euros(item.totalRentCents)} CC
                      {!item.open ? ` · ${item.hint ?? 'Non diffusé'}` : ''}
                    </span>
                  </div>
                  <div className="applications-property__count">
                    <strong>{item.applicationCount}</strong>
                    <span>candidature{item.applicationCount > 1 ? 's' : ''}</span>
                    {freshCount(item.reference) > 0 ? (
                      <span className="badge badge--pending">
                        {freshCount(item.reference)} nouvelle
                        {freshCount(item.reference) > 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="applications-property__open">
                        Ouvrir le suivi <span aria-hidden="true">↗</span>
                      </span>
                    )}
                  </div>
                </Link>
              ))}
          </div>
          {filtered.length === 0 ? (
            <div className="applications-empty">
              <h2>Aucun bien à afficher</h2>
              <p>
                {view.tiles.length
                  ? 'Essayez une autre recherche ou affichez tous vos biens.'
                  : 'Vos logements apparaîtront ici après le dépôt de votre première annonce.'}
              </p>
              {view.tiles.length ? (
                <button
                  className="link"
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setScope('all');
                    setPage(1);
                  }}
                >
                  Réinitialiser la recherche
                </button>
              ) : (
                <Link className="btn" href="/proprietaires/biens/nouveau">
                  Déposer une annonce
                </Link>
              )}
            </div>
          ) : null}
          {pages > 1 ? (
            <nav className="applications-pagination" aria-label="Pages des biens">
              <button
                className="btn btn--ghost btn-sm"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Précédent
              </button>
              <span>
                Page {currentPage} sur {pages}
              </span>
              <button
                className="btn btn--ghost btn-sm"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Suivant
              </button>
            </nav>
          ) : null}
        </>
      ) : (
        <>
          <Link className="applications-back" href="/proprietaires/candidatures">
            ← Tous mes biens
          </Link>
          <div className="applications-selected-property">
            <OwnerPropertyPhoto src={tile.photoUrl} title={tile.title} />
            <div>
              <span className="label label--accent">Candidatures pour {tile.reference}</span>
              <h2>{tile.title}</h2>
              <p>
                {tile.addressLine} · {tile.district}
              </p>
              <span className="p-sm">
                {fmt.euros(tile.totalRentCents)} CC · {rows.length} candidature
                {rows.length > 1 ? 's' : ''}
              </span>
            </div>
            <Link className="link" href={`/proprietaires/biens/${tile.reference}`}>
              Voir le bien ↗
            </Link>
          </div>
          {rows.length ? (
            <div className="applications-review">
              <nav
                className="applications-candidates"
                aria-label={`Candidats pour ${tile.title}`}
              >
                <div className="applications-candidates__heading">
                  <h3>Les candidats</h3>
                  <span>Par taux d’effort croissant</span>
                </div>
                {rows.map((row) => (
                  <Link
                    key={row.id}
                    href={href(tile.reference, row.id)}
                    scroll={false}
                    className="applications-candidate"
                    aria-current={selected?.id === row.id ? 'true' : undefined}
                  >
                    <div className="flex ai-c gap-12">
                      <span className="mono-av">{row.tenantInitials}</span>
                      <div>
                        <strong>{row.tenantName}</strong>
                        <span className="applications-candidate__ref">
                          {row.fileReference}
                        </span>
                      </div>
                    </div>
                    <div className="applications-candidate__meta">
                      <Status status={row.status} />
                      <span>
                        {row.effortRate === null
                          ? 'Taux non renseigné'
                          : `${fmt.percent(row.effortRate)} d’effort`}
                      </span>
                    </div>
                    <span className="applications-candidate__date">
                      Reçue {fmt.relativeAge(row.submittedAt)}
                    </span>
                  </Link>
                ))}
              </nav>
              {selected ? (
                <section
                  className="applications-detail"
                  aria-label={`Dossier de ${selected.tenantName}`}
                >
                  <div className="applications-detail__head">
                    <span className="label">
                      {selected.fileReference} · {tile.reference}
                    </span>
                    <div className="between">
                      <h3>{selected.tenantName}</h3>
                      <Status status={selected.status} />
                    </div>
                    <p>Reçue {fmt.relativeAge(selected.submittedAt)}</p>
                  </div>
                  <dl className="applications-facts">
                    {[
                      [
                        selected.incomeVerified ? 'Revenus nets vérifiés' : 'Revenus déclarés · à vérifier',
                        selected.netMonthlyIncomeCents === null
                          ? 'Non renseignés'
                          : fmt.euros(selected.netMonthlyIncomeCents),
                      ],
                      [
                        'Taux d’effort',
                        selected.effortRate === null
                          ? 'Non renseigné'
                          : fmt.percent(selected.effortRate),
                      ],
                      [
                        'Situation',
                        selected.contractType
                          ? (CONTRACT[selected.contractType] ?? selected.contractType)
                          : 'Non renseignée',
                      ],
                      ['Employeur', selected.employerName ?? 'Non renseigné'],
                      ['Garant', selected.guarantorLabel ?? 'Aucun'],
                      [
                        'Identité',
                        selected.identityVerified ? 'Vérifiée' : 'En cours de vérification',
                      ],
                      [
                        'Pièces vérifiées',
                        `${selected.verifiedDocumentCount} / ${selected.documentCount}`,
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {selected.message ? (
                    <div className="applications-message">
                      <h4>Message du candidat</h4>
                      <p>{selected.message}</p>
                    </div>
                  ) : null}
                  <p className="applications-privacy">
                    Le taux d’effort compare le loyer charges comprises aux revenus nets. Les
                    pièces justificatives restent chez whoma.
                  </p>
                  <div className="applications-actions">
                    <ApplicationDecision
                      key={selected.id}
                      applicationId={selected.id}
                      status={selected.status}
                    />
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="applications-empty">
              <h3>Aucune candidature pour ce logement</h3>
              <p>
                {tile.open
                  ? 'Les nouveaux dossiers apparaîtront ici.'
                  : `Ce logement est ${tile.hint ?? 'non diffusé'}.`}
              </p>
              <Link href="/proprietaires/candidatures" className="link">
                Revenir à tous mes biens
              </Link>
            </div>
          )}
          <details className="applications-journal">
            <summary>Journal du bien · {tile.reference}</summary>
            <ul>
              {tile.publishedAt ? (
                <li>
                  <time>{fmt.logStamp(tile.publishedAt)}</time> Mise en ligne du bien
                </li>
              ) : null}
              {rows.map((row) => (
                <li key={row.id}>
                  <time>{fmt.logStamp(row.submittedAt)}</time> {row.tenantName} a candidaté ·{' '}
                  {STATUS[row.status][0]}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
