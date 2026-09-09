import type { TenantFileView } from '@/lib/api';
import * as fmt from '@/lib/format';

export type TenantSection = 'overview' | 'profile' | 'documents' | 'guarantor';
const STATUS = {
  DRAFT: [
    'Préparons votre dossier',
    'Complétez les informations demandées, puis transmettez votre dossier à whoma.',
  ],
  SUBMITTED: [
    'Dossier transmis',
    'Votre dossier est en attente de contrôle. Les pièces reçues seront examinées par whoma.',
  ],
  UNDER_REVIEW: [
    'Contrôle en cours',
    'Un agent examine votre dossier. Vous pouvez le consulter ; les modifications sont temporairement suspendues.',
  ],
  VERIFIED: [
    'Votre dossier est vérifié',
    'Il est prêt à accompagner vos candidatures depuis les annonces.',
  ],
  INCOMPLETE: [
    'Des éléments sont à compléter',
    'Consultez les pièces manquantes ou à remplacer, puis renvoyez le dossier si nécessaire.',
  ],
  REJECTED: [
    'Votre dossier a été refusé',
    'Consultez les motifs du contrôle avant de corriger les éléments concernés.',
  ],
};
const GROUPS = [
  ['identity', 'Identité'],
  ['income', 'Revenus'],
  ['housing', 'Domicile'],
  ['guarantor', 'Garant'],
] as const;
const LABELS = {
  MISSING: 'À compléter',
  PENDING: 'À contrôler',
  PROCESSING: 'En cours',
  VERIFIED: 'Validé',
  REJECTED: 'À remplacer',
  EXPIRED: 'Expiré',
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

export function TenantFileOverview({
  file,
  onSelect,
  onSubmit,
  pending,
  error,
}: {
  file: TenantFileView;
  onSelect: (section: TenantSection) => void;
  onSubmit: () => void;
  pending: boolean;
  error?: string;
}) {
  const [title, note] = STATUS[file.status];
  const profileMissing = !file.contractType || file.netMonthlyIncomeCents === null;
  const attention = file.slots.filter(
    (slot) =>
      (slot.required || slot.documents.length > 0) &&
      ['MISSING', 'REJECTED', 'EXPIRED'].includes(slot.status),
  );
  const nextSection: TenantSection = profileMissing
    ? 'profile'
    : attention[0]?.group === 'guarantor'
      ? 'guarantor'
      : 'documents';
  const needsAction = profileMissing || file.missing.length > 0 || attention.length > 0;
  const canSubmit = ['DRAFT', 'INCOMPLETE', 'REJECTED'].includes(file.status);
  const submissionBlocked = file.missing.length > 0;
  const locked = file.status === 'UNDER_REVIEW';
  const progress = file.expectedSlotCount
    ? Math.min(1, file.verifiedSlotCount / file.expectedSlotCount)
    : 0;
  const latest = [...file.journal].sort((a, b) => b.at.localeCompare(a.at))[0];
  const nextLabel =
    nextSection === 'profile'
      ? 'Renseigner ma situation'
      : nextSection === 'guarantor'
        ? 'Compléter mon garant'
        : 'Voir les pièces à traiter';

  return (
    <>
      <div
        className={`tenant-file-status${file.status === 'REJECTED' ? ' tenant-file-status--rejected' : ''}`}
      >
        <div>
          <span className="label">Où en est votre dossier ?</span>
          <h2>{title}</h2>
          <p>{note}</p>
          {file.verifiedAt && file.status === 'VERIFIED' ? (
            <p className="tenant-verification-date">
              Version {file.verifiedRevision} validée le {fmt.longDate(file.verifiedAt)}
            </p>
          ) : null}
        </div>
        <div className="tenant-file-status__progress">
          <strong>
            {file.verifiedSlotCount}
            <span> / {file.expectedSlotCount}</span>
          </strong>
          <span>pièces vérifiées</span>
          <div className="bar">
            <span
              className="bar-fill bar-fill--set"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
        </div>
      </div>
      {!locked && needsAction ? (
        <section className="tenant-next-actions" aria-label="Prochaine action">
          <span className="label">Votre prochaine étape</span>
          <h3>
            {profileMissing
              ? 'Renseignez votre activité et vos revenus'
              : 'Complétez les éléments demandés'}
          </h3>
          <ul className="checklist">
            {(file.missing.length
              ? file.missing
              : profileMissing
                ? ['Situation professionnelle et revenus mensuels']
                : attention.map((slot) => slot.label)
            ).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button className="btn btn-sm" type="button" onClick={() => onSelect(nextSection)}>
            {nextLabel}
          </button>
        </section>
      ) : null}
      {canSubmit ? (
        <div className="tenant-file-submit">
          <div>
            <h3>
              {submissionBlocked
                ? 'Transmettre après avoir complété le dossier'
                : 'Tout est prêt pour l’envoi'}
            </h3>
            <p>
              {submissionBlocked
                ? 'Le bouton sera disponible une fois les éléments manquants renseignés.'
                : 'Envoyez vos informations à whoma pour lancer leur vérification.'}
            </p>
          </div>
          <button
            type="button"
            className="btn"
            disabled={pending || submissionBlocked}
            onClick={onSubmit}
          >
            {pending
              ? 'Envoi…'
              : file.status === 'DRAFT'
                ? 'Transmettre mon dossier'
                : 'Renvoyer mon dossier'}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="auth__error mt-16" role="alert">
          {error}
        </p>
      ) : null}
      <section className="tenant-verification-summary" aria-label="Suivi des vérifications">
        <h3>Le suivi de vos informations</h3>
        <div>
          {GROUPS.filter(([key]) => key !== 'guarantor' || file.guarantor).map(
            ([key, label]) => (
              <p key={key}>
                <span>{label}</span>
                <strong
                  className={`tenant-check-state tenant-check-state--${file.groups[key].toLowerCase()}`}
                >
                  {LABELS[file.groups[key]]}
                </strong>
              </p>
            ),
          )}
        </div>
      </section>
      {file.awaiting.length ? (
        <details className="tenant-detail">
          <summary>
            Pièces reçues, en attente de contrôle <span>{file.awaiting.length}</span>
          </summary>
          <p className="p-sm mb-12">Aucun nouvel envoi n’est nécessaire pour ces pièces.</p>
          <ul className="checklist checklist--muted">
            {file.awaiting.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <details className="tenant-detail">
        <summary>Ce que voient les propriétaires</summary>
        <div className="tenant-summary">
          <div>
            <span>Revenus nets {file.incomeVerified ? 'vérifiés' : 'déclarés'}</span>
            <strong>
              {file.netMonthlyIncomeCents === null
                ? 'Non renseignés'
                : fmt.euros(file.netMonthlyIncomeCents)}
            </strong>
          </div>
          <div>
            <span>Situation</span>
            <strong>
              {file.contractType ? CONTRACT[file.contractType] : 'Non renseignée'}
            </strong>
          </div>
          <div>
            <span>Garant</span>
            <strong>
              {file.guarantor === null
                ? 'Non déclaré'
                : file.guarantor.kind === 'ORGANISATION'
                  ? file.guarantor.organisationName
                  : 'Personne physique'}
            </strong>
          </div>
        </div>
        <p className="field__hint">
          Seule la synthèse accompagne vos candidatures. Vos documents restent privés.
        </p>
      </details>
      <details className="tenant-detail">
        <summary>
          Historique de vérification
          {latest ? (
            <small className="tenant-history-latest">
              Dernière activité : {fmt.logStamp(latest.at)}
            </small>
          ) : null}
        </summary>
        <div className="log">
          {file.journal.length ? (
            [...file.journal]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((entry, index) => (
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
              ))
          ) : (
            <p className="p-sm">Le suivi apparaîtra après vos premières démarches.</p>
          )}
        </div>
        {file.verificationDriver === 'mock' ? (
          <p className="field__hint mt-12">
            Les contrôles de cet environnement de démonstration sont simulés.
          </p>
        ) : null}
      </details>
    </>
  );
}
