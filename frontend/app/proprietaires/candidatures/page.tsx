import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OwnerAside } from '@/components/owner-aside';
import { getCurrentUser, getOwnerApplications, getOwnerSummary } from '@/lib/api';
import type {
  ApplicationStatus,
  ApplicationTile,
  OwnerApplication,
} from '@/lib/api';
import * as fmt from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Candidatures reçues' };

const STATUS: Record<ApplicationStatus, { label: string; tone: string }> = {
  SUBMITTED: { label: 'Nouvelle', tone: 'badge badge--pending' },
  READ: { label: 'Lue', tone: 'badge badge--mute' },
  SHORTLISTED: { label: 'Retenue', tone: 'badge badge--ok' },
  VISIT_SCHEDULED: { label: 'Visite planifiée', tone: 'badge badge--ok' },
  ACCEPTED: { label: 'Acceptée', tone: 'badge badge--ok' },
  REJECTED: { label: 'Écartée', tone: 'badge badge--reject' },
  WITHDRAWN: { label: 'Retirée', tone: 'badge badge--mute' },
  EXPIRED: { label: 'Expirée', tone: 'badge badge--mute' },
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

/**
 * Tonalité de la jauge de taux d'effort.
 *
 * Un tiers du revenu est la limite usuelle du marché ; au-delà de 40 % le
 * dossier ne passe généralement pas. Ces seuils colorent la jauge, ils ne
 * décident rien — c'est le propriétaire qui tranche.
 */
function effortTone(rate: number): string {
  if (rate <= 0.33) return '';
  if (rate <= 0.4) return ' gauge__fill--pending';
  return ' gauge__fill--reject';
}

function EffortGauge({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="muted">—</span>;
  return (
    <span className="gauge">
      <span className="gauge__bar">
        <span
          className={`gauge__fill${effortTone(rate)}`}
          style={{ transform: `scaleX(${Math.min(rate, 1)})` }}
        />
      </span>
      {fmt.percent(rate)}
    </span>
  );
}

/**
 * Journal du bien.
 *
 * Reconstitué à partir de ce qui existe réellement — la mise en ligne et les
 * candidatures reçues. Les visites viendront s'y ajouter à l'écran 5 ; d'ici
 * là, mieux vaut un journal court qu'un journal inventé.
 */
function journalOf(tile: ApplicationTile, applications: OwnerApplication[]) {
  const entries = applications.map((application) => ({
    at: application.submittedAt,
    tone: application.status === 'SUBMITTED' ? 'pending' : 'ok',
    title: `${application.tenantName} a candidaté`,
    note:
      application.verifiedDocumentCount === application.documentCount
        ? 'Dossier complet, vérifié par Bail'
        : `${application.documentCount - application.verifiedDocumentCount} pièce${
            application.documentCount - application.verifiedDocumentCount > 1 ? 's' : ''
          } en cours de vérification`,
  }));

  if (tile.publishedAt) {
    entries.push({
      at: tile.publishedAt,
      tone: 'ok',
      title: 'Annonce mise en ligne',
      note: 'Contrôle Bail validé',
    });
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

export default async function OwnerApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  // Le contrôle qui compte est le guard de rôle côté API ; cette redirection
  // évite seulement d'afficher un écran vide.
  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');

  const [params, summary, view] = await Promise.all([
    searchParams,
    getOwnerSummary(),
    getOwnerApplications(),
  ]);

  const asked = typeof params.bien === 'string' ? params.bien : null;
  // À défaut de sélection explicite, le bien qui a le plus de candidatures :
  // c'est celui qui demande une décision.
  const selectedTile =
    view.tiles.find((tile) => tile.reference === asked) ??
    [...view.tiles].sort((a, b) => b.applicationCount - a.applicationCount)[0] ??
    null;

  const rows = selectedTile
    ? view.applications.filter(
        (application) => application.propertyReference === selectedTile.reference,
      )
    : [];

  const askedApplication =
    typeof params.candidat === 'string' ? params.candidat : null;
  const selected =
    rows.find((application) => application.id === askedApplication) ?? rows[0] ?? null;

  const href = (reference: string, applicationId?: string) =>
    `/proprietaires/candidatures?bien=${encodeURIComponent(reference)}${
      applicationId ? `&candidat=${encodeURIComponent(applicationId)}` : ''
    }`;

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="app">
        <OwnerAside user={user} summary={summary} current="applications" />

        <div className="body">
          <div className="page__head">
            <div>
              <span className="label label--accent">
                Espace propriétaire · {user.firstName} {user.lastName}
              </span>
              <h1 className="d3 mt-8">Candidatures reçues</h1>
            </div>

            <div className="stats">
              <div>
                <span className="label">Nouvelles</span>
                <div className="stat__value accent">{view.newCount}</div>
              </div>
              <div>
                <span className="label">En étude</span>
                <div className="stat__value">{view.underReviewCount}</div>
              </div>
              <div>
                <span className="label">Visites planifiées</span>
                <div className="stat__value">{view.visitsScheduledCount}</div>
              </div>
              <div>
                <span className="label">Délai de réponse</span>
                <div className="stat__value">
                  {view.averageResponseHours === null
                    ? '—'
                    : `${view.averageResponseHours} h`}
                </div>
              </div>
            </div>
          </div>

          {view.tiles.length === 0 ? (
            <div className="panel mt-24" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <p className="p" style={{ margin: '0 auto' }}>
                Aucun bien au portefeuille. Déposez une annonce pour commencer à recevoir
                des candidatures.
              </p>
              <Link href="/proprietaires/biens/nouveau" className="btn mt-16">
                Déposer une annonce
              </Link>
            </div>
          ) : (
            <div className="tiles mt-24">
              {view.tiles.map((tile) => (
                <Link
                  key={tile.reference}
                  href={href(tile.reference)}
                  className={`tile${
                    tile.applicationCount > 0 ? ' tile--accent' : ''
                  }${tile.open ? '' : ' tile--pending'}`}
                  aria-current={
                    selectedTile?.reference === tile.reference ? 'true' : undefined
                  }
                >
                  <span className="label">
                    {tile.reference} · {tile.district}
                  </span>
                  <div className="tile__value">
                    {tile.open ? tile.applicationCount : '—'}
                  </div>
                  <div className="tile__note">
                    {tile.open
                      ? `candidature${tile.applicationCount > 1 ? 's' : ''} · ${
                          tile.title
                        }, ${fmt.euros(tile.totalRentCents)} CC`
                      : `${tile.hint ?? 'non diffusé'} · ${tile.title}`}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {selectedTile ? (
            <div className="split split--wide mt-32">
              <div>
                <div className="between mb-12">
                  <h2 className="h">
                    {selectedTile.reference} — {selectedTile.title}
                  </h2>
                  <span className="label">
                    {rows.length === 0
                      ? 'aucune candidature'
                      : `${rows.length} candidature${
                          rows.length > 1 ? 's' : ''
                        } · triées par taux d’effort`}
                  </span>
                </div>

                {rows.length === 0 ? (
                  <div className="panel pad">
                    <p className="p-sm">
                      {selectedTile.open
                        ? 'Aucune candidature sur ce bien pour l’instant. Les dossiers arrivent déjà vérifiés : vous n’aurez rien à contrôler vous-même.'
                        : `Ce bien est ${selectedTile.hint ?? 'non diffusé'} : il ne peut pas recevoir de candidature.`}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="tbl__scroll">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Candidat</th>
                            <th>Dossier</th>
                            <th className="r">Revenus nets</th>
                            <th>Taux d’effort</th>
                            <th>Statut</th>
                            <th className="r">Reçue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((application) => (
                            <tr
                              key={application.id}
                              className={
                                selected?.id === application.id ? 'is-selected' : undefined
                              }
                            >
                              <td>
                                <Link
                                  href={href(selectedTile.reference, application.id)}
                                  className="tbl__pick"
                                >
                                  <span className="mono-av">
                                    {application.tenantInitials}
                                  </span>
                                  <span>
                                    <span className="tbl__name">
                                      {application.tenantName}
                                    </span>
                                    <span className="tbl__sub">
                                      {application.fileReference}
                                    </span>
                                  </span>
                                </Link>
                              </td>
                              <td>
                                {/* La pastille suit le compte de pièces, pas le
                                    statut du dossier : afficher « 3 / 5 » en vert
                                    parce que le dossier est marqué vérifié se
                                    contredirait à l'œil. */}
                                <span
                                  className={`badge badge--${
                                    application.verifiedDocumentCount ===
                                    application.documentCount
                                      ? 'ok'
                                      : 'pending'
                                  }`}
                                >
                                  {application.verifiedDocumentCount} /{' '}
                                  {application.documentCount}
                                </span>
                              </td>
                              <td className="r n">
                                {application.netMonthlyIncomeCents === null
                                  ? '—'
                                  : fmt.euros(application.netMonthlyIncomeCents)}
                              </td>
                              <td>
                                <EffortGauge rate={application.effortRate} />
                              </td>
                              <td>
                                <span className={STATUS[application.status].tone}>
                                  {STATUS[application.status].label}
                                </span>
                              </td>
                              <td className="r n">
                                {fmt.relativeAge(application.submittedAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="field__hint mt-10">
                      Loyer charges comprises rapporté aux revenus nets vérifiés. Les
                      pièces justificatives restent chez Bail : vous voyez le résultat des
                      contrôles, pas les documents.
                    </p>
                  </>
                )}
              </div>

              <aside>
                {selected ? (
                  <div className="panel panel--strong tick">
                    <div
                      className="pad"
                      style={{ borderBottom: '1px solid var(--line-softer)' }}
                    >
                      <div className="flex jc-b ai-c gap-12 wrap">
                        <div className="flex ai-c gap-12">
                          <span className="mono-av">{selected.tenantInitials}</span>
                          <div>
                            <div className="h-sm">{selected.tenantName}</div>
                            <div className="doc__m">{selected.fileReference}</div>
                          </div>
                        </div>
                        <span className={STATUS[selected.status].tone}>
                          {STATUS[selected.status].label}
                        </span>
                      </div>
                    </div>

                    <div className="pad">
                      <div className="kv">
                        <span className="kv__k">Situation</span>
                        <span className="kv__v">
                          {selected.contractType
                            ? (CONTRACT[selected.contractType] ?? selected.contractType)
                            : '—'}
                        </span>
                      </div>
                      <div className="kv">
                        <span className="kv__k">Employeur</span>
                        <span className="kv__v">{selected.employerName ?? '—'}</span>
                      </div>
                      <div className="kv">
                        <span className="kv__k">Revenus nets mensuels</span>
                        <span className="kv__v">
                          {selected.netMonthlyIncomeCents === null
                            ? '—'
                            : fmt.euros(selected.netMonthlyIncomeCents)}
                        </span>
                      </div>
                      <div className="kv">
                        <span className="kv__k">Taux d’effort</span>
                        <span className="kv__v">
                          <EffortGauge rate={selected.effortRate} />
                        </span>
                      </div>
                      <div className="kv">
                        <span className="kv__k">Garant</span>
                        <span className="kv__v">
                          {selected.guarantorLabel ?? 'Aucun'}
                        </span>
                      </div>
                      <div className="kv">
                        <span className="kv__k">Identité</span>
                        <span className="kv__v">
                          <span
                            className={`badge badge--${
                              selected.identityVerified ? 'ok' : 'pending'
                            } badge--nodot`}
                          >
                            {selected.identityVerified ? 'Vérifiée' : 'En cours'}
                          </span>
                        </span>
                      </div>
                      <div className="kv">
                        <span className="kv__k">Pièces vérifiées</span>
                        <span className="kv__v">
                          {selected.verifiedDocumentCount} / {selected.documentCount}
                        </span>
                      </div>
                    </div>

                    {selected.message ? (
                      <div
                        className="pad"
                        style={{ borderTop: '1px solid var(--line-softer)' }}
                      >
                        <span className="label label--ink">Message du candidat</span>
                        <p className="p-sm mt-8">{selected.message}</p>
                      </div>
                    ) : null}

                    <div
                      className="pad wash"
                      style={{ borderTop: '1px solid var(--line-softer)' }}
                    >
                      <div className="flex gap-10 wrap">
                        <button
                          className="btn btn-sm"
                          type="button"
                          style={{ flex: '1 1 auto' }}
                          disabled
                        >
                          Proposer une visite
                        </button>
                        <button
                          className="btn btn--ghost btn-sm"
                          type="button"
                          style={{ flex: '1 1 auto' }}
                          disabled
                        >
                          Écarter
                        </button>
                      </div>
                      <p className="field__hint mt-10">
                        Décider d’une candidature arrive avec la prise de rendez-vous de
                        visite, en cours de construction. Cet écran est pour l’instant en
                        lecture seule.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className={`panel${selected ? ' mt-16' : ''}`}>
                  <div
                    className="pad-sm"
                    style={{ borderBottom: '1px solid var(--line-softer)' }}
                  >
                    <span className="label label--ink">Journal du bien</span>
                  </div>
                  <div className="pad-sm">
                    <div className="log">
                      {journalOf(selectedTile, rows).map((entry) => (
                        <div
                          key={`${entry.at}-${entry.title}`}
                          className={`log__entry log__entry--${entry.tone}`}
                        >
                          <span className="log__date">{fmt.logStamp(entry.at)}</span>
                          <div>
                            <span className="log__title">{entry.title}</span>
                            <span className="log__note">{entry.note}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
