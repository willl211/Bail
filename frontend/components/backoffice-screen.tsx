'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  AdminAgent,
  AdminFileRow,
  AdminLeaseRow,
  AdminPropertyRow,
  AdminVisitRow,
  BackofficeSummary,
  JournalEntry,
  ProviderRow,
} from '@/lib/api';
import * as fmt from '@/lib/format';
import { assignVisit, decideDocument, decideFile, type AdminFailure } from '@/lib/admin-client';

import { AdminDocumentReview } from './admin-document-review';
import { AdminPropertyReview } from './admin-property-review';

type Pane = 'dossiers' | 'biens' | 'baux' | 'journal';

const EMPLOYMENT_LABELS: Record<string, string> = {
  CDI: 'Salarié·e en CDI',
  CDD: 'Salarié·e en CDD',
  PUBLIC_SECTOR: 'Fonction publique',
  SELF_EMPLOYED: 'Indépendant·e',
  STUDENT: 'Étudiant·e',
  RETIRED: 'Retraité·e',
  OTHER: 'Autre situation',
};

const FILE_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Brouillon', tone: 'badge badge--mute' },
  SUBMITTED: { label: 'À contrôler', tone: 'badge badge--pending' },
  UNDER_REVIEW: { label: 'En cours', tone: 'badge badge--pending' },
  VERIFIED: { label: 'Vérifié', tone: 'badge badge--ok' },
  INCOMPLETE: { label: 'Incomplet', tone: 'badge badge--reject' },
  REJECTED: { label: 'Refusé', tone: 'badge badge--reject' },
};

const LEASE_STATUS: Record<string, string> = {
  DRAFT: 'brouillon',
  FIELDS_VALIDATED: 'champs vérifiés',
  SENT_FOR_SIGNATURE: 'en signature',
  PARTIALLY_SIGNED: '1 / 2 signée',
  SIGNED: 'signé',
  DECLINED: 'refusé',
  EXPIRED: 'expiré',
  CANCELLED: 'annulé',
};

/**
 * Back-office — registre de l'agence.
 *
 * Réservé à l'agent interne. C'est ici que se prennent les décisions qui
 * débloquent les parcours déjà construits : mettre une annonce en ligne,
 * trancher sur une pièce en revue humaine, affecter un agent à une visite.
 */
export function BackofficeScreen({
  summary,
  providers,
  files: initialFiles,
  properties: initialProperties,
  leases,
  visits: initialVisits,
  agents,
  journal,
}: {
  summary: BackofficeSummary;
  providers: ProviderRow[];
  files: AdminFileRow[];
  properties: AdminPropertyRow[];
  leases: AdminLeaseRow[];
  visits: AdminVisitRow[];
  agents: AdminAgent[];
  journal: JournalEntry[];
}) {
  const router = useRouter();
  const [pane, setPane] = useState<Pane>('dossiers');
  const [files, setFiles] = useState(initialFiles);
  const [properties, setProperties] = useState(initialProperties);
  const [visits, setVisits] = useState(initialVisits);
  const [selectedFile, setSelectedFile] = useState(initialFiles[0]?.reference ?? null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<AdminFailure | null>(null);
  const [reason, setReason] = useState('');

  // Chaque décision renvoie la liste à jour, qu'on garde en état local. Mais
  // quand le serveur renvoie une version plus récente — après un refus dû à un
  // écran périmé, par exemple —, c'est elle qui fait foi : sans cette remise à
  // niveau, le registre continuerait d'afficher un état que le serveur vient
  // de refuser.
  const [serverFiles, setServerFiles] = useState(initialFiles);
  if (serverFiles !== initialFiles) {
    setServerFiles(initialFiles);
    setFiles(initialFiles);
    setProperties(initialProperties);
    setVisits(initialVisits);
  }

  const file = files.find((entry) => entry.reference === selectedFile) ?? files[0] ?? null;

  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key);
    setError(null);
    try {
      await action();
      setReason('');
    } catch (failure) {
      setError(failure as AdminFailure);
      // Le compteur d'en-tête et les listes viennent du serveur : après un
      // refus, on les redemande plutôt que de laisser l'agent devant un écran
      // qui n'est plus vrai.
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const tabs: { key: Pane; label: string; count: number | null }[] = [
    { key: 'dossiers', label: 'Dossiers', count: summary.filesToReview },
    { key: 'biens', label: 'Biens', count: summary.propertiesToReview },
    { key: 'baux', label: 'Baux & paiements', count: leases.length },
    { key: 'journal', label: 'Journal', count: null },
  ];

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="page__head">
        <div>
          <span className="label label--accent">Back-office · agence whoma Metz</span>
          <h1 className="d3 mt-8">Registre</h1>
        </div>

        <div className="stats">
          <div>
            <span className="label">Dossiers à vérifier</span>
            <div className="stat__value accent">{summary.filesToReview}</div>
          </div>
          <div>
            <span className="label">Biens à contrôler</span>
            <div className="stat__value">{summary.propertiesToReview}</div>
          </div>
          <div>
            {/* Les baux engagés, pas les brouillons : « en cours » aurait
                laissé croire qu'un bail ouvert mais non envoyé y compte. */}
            <span className="label">Baux en signature</span>
            <div className="stat__value">{summary.activeLeases}</div>
          </div>
          <div>
            <span className="label">À reverser</span>
            <div className="stat__value">{fmt.euros(summary.pendingPayoutCents)}</div>
          </div>
        </div>
      </div>

      <div className="tiles mt-24">
        <div className="tile">
          <span className="label">Biens en ligne</span>
          <div className="tile__value">{summary.onlinePropertyCount}</div>
          <div className="tile__note">diffusés et facturés</div>
        </div>
        <div className="tile">
          <span className="label">Dossiers actifs</span>
          <div className="tile__value">{summary.activeFileCount}</div>
          <div className="tile__note">
            {summary.verifiedFileCount > 1
              ? `dont ${summary.verifiedFileCount} entièrement vérifiés`
              : `dont ${summary.verifiedFileCount} entièrement vérifié`}
          </div>
        </div>
        <div className="tile tile--accent">
          <span className="label">Délai de vérification</span>
          <div className="tile__value">
            {summary.averageReviewHours === null ? '—' : `${summary.averageReviewHours} h`}
          </div>
          <div className="tile__note">
            {summary.averageReviewHours === null
              ? 'aucune pièce contrôlée'
              : 'mesuré sur les contrôles réels · cible 24 h'}
          </div>
        </div>
        <div className="tile tile--pending">
          <span className="label">Prestataires réels</span>
          <div className="tile__value">{providers.filter((p) => p.live).length}</div>
          <div className="tile__note">sur {providers.length} · aucun en production</div>
        </div>
      </div>

      <div className="admin__tabs mt-32">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="admin__tab"
            aria-current={pane === tab.key ? 'true' : undefined}
            onClick={() => {
              setPane(tab.key);
              // Le motif est remis à zéro en changeant d'onglet : celui de
              // l'onglet Dossiers part au locataire, celui de l'onglet Biens
              // au propriétaire. Le reporter tel quel enverrait le mauvais
              // texte à la mauvaise personne.
              setReason('');
              setError(null);
            }}
          >
            {tab.label}
            {tab.count !== null ? <span className="admin__count">{tab.count}</span> : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="auth__error mb-16" role="alert">
          {error.message}
          {error.blockers ? (
            <ul className="checklist mt-10">
              {error.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------- Dossiers */}
      {pane === 'dossiers' ? (
        <div className="admin-file-review">
          <div>
            <div className="tbl__scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Dossier</th>
                    <th>Pièces</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((row) => (
                    <tr
                      key={row.reference}
                      className={file?.reference === row.reference ? 'is-selected' : undefined}
                    >
                      <td>
                        <button
                          type="button"
                          className="tbl__pick"
                          onClick={() => {
                            setSelectedFile(row.reference);
                            setReason('');
                            setError(null);
                          }}
                        >
                          <span className="mono-av">{row.initials}</span>
                          <span>
                            <span className="tbl__name">{row.holderName}</span>
                            <span className="tbl__sub">{row.reference}</span>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span
                          className={`badge badge--${
                            row.verifiedCount === row.requiredCount ? 'ok' : 'pending'
                          }`}
                        >
                          {row.verifiedCount} / {row.requiredCount}
                        </span>
                      </td>
                      <td>
                        <span className={FILE_STATUS[row.status].tone}>
                          {FILE_STATUS[row.status].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="field__hint mt-10">
              Sélectionnez un dossier, puis examinez chaque pièce. La validation du dossier reste
              distincte de celle des justificatifs.
            </p>
          </div>

          <aside>
            {file ? (
              <div className="panel panel--strong tick">
                <div className="pad" style={{ borderBottom: '1px solid var(--line-softer)' }}>
                  <div className="flex jc-b ai-c gap-12 wrap">
                    <div className="flex ai-c gap-12">
                      <span className="mono-av">{file.initials}</span>
                      <div>
                        <div className="h-sm">{file.holderName}</div>
                        <div className="doc__m">
                          {file.reference} · Version {file.revision}
                          {file.submittedAt ? ` · Déposé ${fmt.relativeAge(file.submittedAt)}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className={FILE_STATUS[file.status].tone}>
                      {FILE_STATUS[file.status].label}
                    </span>
                  </div>
                </div>

                <div className="pad">
                  <dl className="mb-16">
                    {[
                      [
                        'Revenus mensuels déclarés',
                        file.profile.netMonthlyIncomeCents === null
                          ? 'Non renseignés'
                          : fmt.euros(file.profile.netMonthlyIncomeCents),
                      ],
                      [
                        'Situation',
                        EMPLOYMENT_LABELS[file.profile.contractType ?? ''] ?? 'Non renseignée',
                      ],
                      ['Employeur', file.profile.employerName ?? 'Non renseigné'],
                      [
                        'Période d’essai',
                        file.profile.inProbationPeriod === null
                          ? 'Non renseignée'
                          : file.profile.inProbationPeriod
                            ? 'Oui'
                            : 'Non',
                      ],
                      ['Garant', file.profile.guarantor?.name ?? 'Aucun'],
                      ...(file.profile.guarantor?.netMonthlyIncomeCents != null
                        ? [
                            [
                              'Revenus du garant',
                              fmt.euros(file.profile.guarantor.netMonthlyIncomeCents),
                            ],
                          ]
                        : []),
                    ].map(([label, value]) => (
                      <div className="kv" key={label}>
                        <dt className="kv__k">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {file.missingLabels.length > 0 ? (
                    <div className="mb-16">
                      <span className="label label--ink">Éléments à vérifier ou compléter</span>
                      <ul className="checklist mt-8">
                        {file.missingLabels.map((label) => (
                          <li key={label}>{label}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <AdminDocumentReview
                    key={`${file.reference}:${file.revision}`}
                    kind="tenant"
                    revision={file.revision}
                    documents={file.documents}
                    onError={setError}
                    onDecision={async (id, review) =>
                      setFiles(
                        await decideDocument(id, review.decision, file.revision, review.reason),
                      )
                    }
                  />
                </div>

                <div className="pad wash" style={{ borderTop: '1px solid var(--line-softer)' }}>
                  <label className="field">
                    <span className="label label--ink">
                      Motif <span className="doc__opt">transmis au locataire</span>
                    </span>
                    <textarea
                      className="field__box"
                      rows={2}
                      maxLength={400}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Zone adresse illisible."
                    />
                  </label>

                  <div className="flex gap-10 wrap mt-12">
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ flex: '1 1 auto' }}
                      disabled={
                        pending !== null ||
                        file.status === 'VERIFIED' ||
                        file.missingLabels.length > 0
                      }
                      title={
                        file.missingLabels.length > 0 ? file.missingLabels.join(' · ') : undefined
                      }
                      onClick={() =>
                        run(file.reference, async () =>
                          setFiles(await decideFile(file.reference, 'VERIFY', file.revision)),
                        )
                      }
                    >
                      {file.status === 'VERIFIED' ? 'Dossier vérifié' : 'Valider le dossier'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn-sm"
                      style={{ flex: '1 1 auto' }}
                      disabled={pending !== null || reason.trim() === ''}
                      onClick={() =>
                        run(file.reference, async () =>
                          setFiles(
                            await decideFile(file.reference, 'REJECT', file.revision, reason),
                          ),
                        )
                      }
                    >
                      Rejeter
                    </button>
                  </div>
                  <p className="field__hint mt-10">
                    Un refus est toujours motivé : sans motif, le locataire ne saurait pas quoi
                    corriger. Ses candidatures sont suspendues, pas supprimées.
                  </p>
                  {file.history.length ? (
                    <details className="mt-16">
                      <summary>Historique du dossier</summary>
                      <ul className="checklist mt-10">
                        {file.history.map((entry, index) => (
                          <li key={`${entry.at}-${index}`}>
                            <strong>{entry.title}</strong>
                            <p className="p-sm">{entry.note}</p>
                            <span className="doc__m">{fmt.logStamp(entry.at)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="panel pad">
                <p className="p-sm">Aucun dossier transmis.</p>
              </div>
            )}

            <div className="panel mt-16 pad">
              <span className="label label--ink">Prestataires</span>
              <div className="mt-12">
                {providers.map((provider) => (
                  <div key={provider.key} className="kv">
                    <span className="kv__k">{provider.label}</span>
                    <span className="kv__v">
                      <span
                        className={`badge badge--${provider.live ? 'ok' : 'pending'} badge--nodot`}
                      >
                        {provider.driver}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="field__hint mt-10">
                Aucun prestataire réglementé n’est branché pendant le pilote. Les contrôles,
                signatures et paiements affichés sont simulés.
              </p>
            </div>
          </aside>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- Biens */}
      {pane === 'biens' ? (
        <>
          <AdminPropertyReview properties={properties} onChange={setProperties} />

          <h2 className="h mt-32 mb-12">Visites à affecter</h2>
          {visits.length === 0 ? (
            <div className="panel pad">
              <p className="p-sm">Aucune visite à venir.</p>
            </div>
          ) : (
            <div className="panel panel--strong">
              {visits.map((visit) => (
                <div key={visit.id} className="doc">
                  <div className="doc__head">
                    <div>
                      <div className="doc__n">
                        {visit.propertyReference} · {fmt.appointment(visit.scheduledAt)}
                      </div>
                      <div className="doc__m">
                        {visit.tenantName} · {visit.type === 'VIDEO' ? 'visio' : 'accompagnée'}
                      </div>
                    </div>
                    <div className="doc__c">
                      {visit.agentName ? `Agent : ${visit.agentName}` : 'Aucun agent affecté'}
                    </div>
                    <div className="doc__a">
                      <select
                        className="field__box"
                        style={{ width: 'auto' }}
                        defaultValue=""
                        disabled={pending !== null}
                        onChange={(event) => {
                          const agentId = event.target.value;
                          if (!agentId) return;
                          void run(visit.id, async () =>
                            setVisits(await assignVisit(visit.id, agentId)),
                          );
                        }}
                      >
                        <option value="">Affecter…</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.firstName} {agent.lastName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* -------------------------------------------------- Baux & paiements */}
      {pane === 'baux' ? (
        <>
          {leases.length === 0 ? (
            <div className="panel pad">
              <p className="p-sm">Aucun bail ouvert.</p>
            </div>
          ) : (
            <div className="tbl__scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Bail</th>
                    <th>Bien</th>
                    <th>Signature</th>
                    <th>Honoraires</th>
                    <th>Fonds</th>
                    <th className="r">Loyer</th>
                  </tr>
                </thead>
                <tbody>
                  {leases.map((lease) => (
                    <tr key={lease.reference}>
                      <td>
                        <span className="tbl__name">{lease.reference}</span>
                        <span className="tbl__sub">{lease.tenantName}</span>
                      </td>
                      <td className="n">{lease.propertyReference}</td>
                      <td>
                        {LEASE_STATUS[lease.status]} · {lease.signedCount} / 2
                      </td>
                      <td className="n">
                        {lease.feeAmountCents === null
                          ? '—'
                          : `${fmt.euros(lease.feeAmountCents)} · ${lease.feeStatus}`}
                      </td>
                      <td className="n">{lease.fundsStatus ?? '—'}</td>
                      <td className="r n">{fmt.euros(lease.rentCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel pad mt-16 wash">
            <span className="label label--accent">Circuit des fonds</span>
            <p className="p-sm mt-8">
              La plateforme encaisse dépôts de garantie et premiers loyers pour le compte du
              propriétaire — d’où le besoin d’une carte G en plus de la carte T. Chaque ligne suit
              trois états successifs : <b className="mono">reçu</b>,{' '}
              <b className="mono">à reverser</b>, <b className="mono">reversé</b>. Les honoraires,
              eux, sont encaissés pour compte propre et ne transitent pas.
            </p>
            <p className="field__hint mt-10">
              En attente de reversement : {fmt.euros(summary.pendingPayoutCents)}.
            </p>
          </div>
        </>
      ) : null}

      {/* -------------------------------------------------------- Journal */}
      {pane === 'journal' ? (
        <div className="split split--wide">
          <div className="panel pad">
            {journal.length === 0 ? (
              <p className="p-sm">Aucune activité enregistrée.</p>
            ) : (
              <div className="log">
                {journal.map((entry, index) => (
                  <div
                    key={`${entry.at}-${index}`}
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
            )}
          </div>

          <aside>
            <div className="panel pad">
              <span className="label label--ink">Conservation des données</span>
              <div className="mt-12">
                <div className="kv">
                  <span className="kv__k">Enregistrements de visio</span>
                  <span className="kv__v">15 jours</span>
                </div>
                <div className="kv">
                  <span className="kv__k">Pièces de dossier</span>
                  <span className="kv__v">À trancher</span>
                </div>
                <div className="kv">
                  <span className="kv__k">Baux signés</span>
                  <span className="kv__v">Durée légale</span>
                </div>
                <div className="kv">
                  <span className="kv__k">Hébergement</span>
                  {/* Choix arrêté (docs/tech-stack.md), pas encore en place :
                      l'annoncer au présent serait faux pendant le pilote. */}
                  <span className="kv__v">France · OVH (retenu)</span>
                </div>
              </div>
              <p className="field__hint mt-10">
                La purge des enregistrements est datée à l’ouverture de la salle mais
                <b> aucune tâche ne la déclenche encore</b> : à brancher avant toute visio réelle.
                La durée de conservation des pièces d’un dossier refusé reste à trancher avec
                l’avocat.
              </p>
            </div>

            <div className="panel mt-16 pad">
              <span className="label label--ink">Journal</span>
              <p className="p-sm mt-8">
                Reconstitué à partir d’horodatages réels — publications, candidatures, pièces
                contrôlées, visites, baux. Rien n’est ajouté pour remplir la page : un journal qui
                mentirait sur ce qui s’est passé n’aurait aucune valeur d’audit.
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
