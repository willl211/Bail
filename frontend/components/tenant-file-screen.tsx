'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CurrentUser, DocumentStatus, TenantFileView } from '@/lib/api';
import * as fmt from '@/lib/format';
import { VerifyEmailNotice } from '@/components/verify-email-notice';
import { submitFile, type TenantFailure } from '@/lib/tenant-client';
import { LogoutButton } from './logout-button';
import { TenantDocuments } from './tenant-documents';
import { TenantGuarantorForm } from './tenant-guarantor-form';
import { TenantProfileForm } from './tenant-profile-form';

const FILE_STATUS: Record<string, { label: string; note: string }> = {
  DRAFT: {
    label: 'À compléter',
    note: 'Déposez vos pièces, puis transmettez votre dossier à Bail.',
  },
  SUBMITTED: {
    label: 'Transmis',
    note: 'Bail contrôle vos pièces. Vous pouvez déjà candidater.',
  },
  UNDER_REVIEW: {
    label: 'Contrôle en cours',
    note: 'Un agent examine votre dossier. Il n’est pas modifiable pendant ce temps.',
  },
  VERIFIED: {
    label: 'Vérifié',
    note: 'Votre dossier part en un clic sur chaque annonce.',
  },
  INCOMPLETE: {
    label: 'Incomplet',
    note: 'Une pièce manque pour terminer le contrôle.',
  },
  REJECTED: {
    label: 'Refusé',
    note: 'Contactez Bail : une pièce n’a pas pu être validée.',
  },
};

const GROUP_BADGE: Record<DocumentStatus, { label: string; tone: string }> = {
  MISSING: { label: 'Incomplet', tone: 'badge badge--mute badge--nodot' },
  PENDING: { label: 'À contrôler', tone: 'badge badge--pending badge--nodot' },
  PROCESSING: { label: 'En cours', tone: 'badge badge--pending badge--nodot' },
  VERIFIED: { label: 'Validé', tone: 'badge badge--ok badge--nodot' },
  REJECTED: { label: 'Refusé', tone: 'badge badge--reject badge--nodot' },
  EXPIRED: { label: 'Expiré', tone: 'badge badge--reject badge--nodot' },
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
 * Dossier locataire — écran 3.
 *
 * Composant client parce que chaque geste (dépôt, retrait, garant) renvoie le
 * dossier recalculé par l'API : l'écran se reconstruit sur cette réponse, sans
 * second aller-retour ni recalcul local d'un état que le serveur vient de
 * produire. Le rendu initial, lui, vient du serveur.
 */
export function TenantFileScreen({
  user,
  initial,
}: {
  user: CurrentUser;
  initial: TenantFileView;
}) {
  const [file, setFile] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TenantFailure | null>(null);

  const locked = file.status === 'UNDER_REVIEW';
  const status = FILE_STATUS[file.status] ?? FILE_STATUS.DRAFT;
  const progress =
    file.expectedSlotCount === 0 ? 0 : file.verifiedSlotCount / file.expectedSlotCount;

  // Une ligne facultative et vide n'apprend rien : elle allonge la liste et
  // laisse croire qu'il reste des pièces à fournir. Elle réapparaît dès qu'on
  // y dépose quelque chose, ou dès que la situation déclarée la rend exigible.
  const visible = file.slots.filter((slot) => slot.required || slot.documents.length > 0);
  const ownSlots = visible.filter((slot) => slot.group !== 'guarantor');
  const guarantorSlots = visible.filter((slot) => slot.group === 'guarantor');

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      setFile(await submitFile());
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      {user.emailVerified ? null : <VerifyEmailNotice email={user.email} />}

      <div className="app">
        <aside className="aside">
          <div className="aside__who">
            <span className="label label--accent">Locataire</span>
            <div className="aside__name">
              {user.firstName} {user.lastName}
            </div>
            <div className="aside__meta">{file.reference}</div>
          </div>

          <nav className="aside__nav">
            <Link href="/dossier" className="aside__item" aria-current="true">
              Mon dossier
              <span className="aside__count">
                {file.verifiedSlotCount}/{file.expectedSlotCount}
              </span>
            </Link>
            <Link href="/recherche" className="aside__item">
              Rechercher un bien
            </Link>
          </nav>

          <div className="aside__block">
            <span className="label label--ink">Loyer accessible</span>
            <p className="p-sm mt-8">
              {file.maxRentCents === null
                ? 'Renseignez vos revenus pour le connaître.'
                : `${fmt.euros(file.maxRentCents)} charges comprises`}
            </p>
            <LogoutButton />
          </div>
        </aside>

        <div className="body">
          <div className="page__head">
            <div>
              <span className="label label--accent">Dossier {file.reference}</span>
              <h1 className="d3 mt-8">{file.holderName}</h1>
            </div>

            <div className="stats">
              <div>
                <span className="label">Pièces vérifiées</span>
                <div className="stat__value">
                  {file.verifiedSlotCount} / {file.expectedSlotCount}
                </div>
              </div>
              <div>
                <span className="label">
                  {file.incomeVerified ? 'Revenus vérifiés' : 'Revenus déclarés'}
                </span>
                <div className="stat__value">
                  {file.netMonthlyIncomeCents === null
                    ? '—'
                    : fmt.euros(file.netMonthlyIncomeCents)}
                </div>
              </div>
              <div>
                <span className="label">Loyer accessible</span>
                <div className="stat__value accent">
                  {file.maxRentCents === null ? '—' : fmt.euros(file.maxRentCents)}
                </div>
              </div>
            </div>
          </div>

          <div className="split split--wide mt-24">
            <div>
              <h2 className="h mb-12">Votre situation</h2>
              <div className="panel pad">
                <TenantProfileForm file={file} readOnly={locked} onChange={setFile} />
              </div>

              <div className="between mt-32 mb-10">
                <h2 className="h">Vos pièces</h2>
                <span className="label">
                  {file.expectedSlotCount === 0
                    ? 'Renseignez votre situation'
                    : `${Math.round(progress * 100)} % vérifié`}
                </span>
              </div>
              <div className="bar mb-20">
                <span
                  className="bar-fill bar-fill--set"
                  style={{ transform: `scaleX(${progress})` }}
                />
              </div>

              <TenantDocuments slots={ownSlots} readOnly={locked} onChange={setFile} />

              <h2 className="h mt-32 mb-12">Votre garant</h2>
              <TenantGuarantorForm file={file} readOnly={locked} onChange={setFile} />

              {guarantorSlots.length > 0 ? (
                <div className="mt-16">
                  <TenantDocuments
                    slots={guarantorSlots}
                    readOnly={locked}
                    onChange={setFile}
                  />
                </div>
              ) : null}

              <div className="drop drop--wide mt-20">
                <div className="drop__mark">+</div>
                <div className="h-sm">Vos pièces restent chez Bail</div>
                <p className="p-sm mt-6">
                  PDF, JPG ou PNG · 10 Mo maximum par fichier. Les propriétaires
                  ne reçoivent jamais vos documents, seulement la synthèse de
                  leur contrôle.
                </p>
              </div>
            </div>

            <aside>
              <div className="panel panel--strong tick">
                <div
                  className="pad"
                  style={{ borderBottom: '1px solid var(--line-softer)' }}
                >
                  <span className="label label--ink">Statut du dossier</span>
                  {/* Le libellé ne figure qu'une fois : le répéter en pastille
                      à côté du titre ne dirait rien de plus. */}
                  <div className="d3 mt-8">{status.label}</div>
                  <p className="p-sm mt-6">{status.note}</p>
                </div>

                <div className="pad">
                  {(
                    [
                      ['identity', 'Identité'],
                      ['income', 'Revenus'],
                      ['housing', 'Domicile'],
                      ['guarantor', 'Garant'],
                    ] as const
                  ).map(([group, label]) => (
                    <div key={group} className="kv">
                      <span className="kv__k">{label}</span>
                      <span className="kv__v">
                        {group === 'guarantor' && file.guarantor === null ? (
                          <span className="badge badge--mute badge--nodot">
                            Non déclaré
                          </span>
                        ) : (
                          <span className={GROUP_BADGE[file.groups[group]].tone}>
                            {GROUP_BADGE[file.groups[group]].label}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  className="pad wash"
                  style={{ borderTop: '1px solid var(--line-softer)' }}
                >
                  <span className="label label--accent">
                    Ce que voient les propriétaires
                  </span>
                  <div className="mt-10">
                    <div className="kv">
                      <span className="kv__k">Revenus nets</span>
                      <span className="kv__v">
                        {file.netMonthlyIncomeCents === null
                          ? '—'
                          : fmt.euros(file.netMonthlyIncomeCents)}
                      </span>
                    </div>
                    <div className="kv">
                      <span className="kv__k">Loyer max conseillé</span>
                      <span className="kv__v">
                        {file.maxRentCents === null
                          ? '—'
                          : `${fmt.euros(file.maxRentCents)} CC`}
                      </span>
                    </div>
                    <div className="kv">
                      <span className="kv__k">Situation</span>
                      <span className="kv__v">
                        {file.contractType
                          ? (CONTRACT[file.contractType] ?? file.contractType)
                          : '—'}
                      </span>
                    </div>
                    <div className="kv">
                      <span className="kv__k">Garant</span>
                      <span className="kv__v">
                        {file.guarantor === null
                          ? 'Aucun'
                          : file.guarantor.kind === 'ORGANISATION'
                            ? (file.guarantor.organisationName ?? 'Organisme')
                            : 'Personne physique'}
                      </span>
                    </div>
                  </div>
                  <p className="field__hint mt-10">
                    Vos documents ne quittent jamais Bail. Seule cette synthèse
                    accompagne vos candidatures.
                  </p>
                </div>
              </div>

              {file.missing.length > 0 || file.awaiting.length > 0 ? (
                <div className="panel pad mt-16">
                  {file.missing.length > 0 ? (
                    <>
                      <span className="label label--ink">Il vous reste à faire</span>
                      <ul className="checklist mt-10">
                        {file.missing.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {file.awaiting.length > 0 ? (
                    <>
                      <span
                        className={`label label--ink${file.missing.length > 0 ? ' mt-16' : ''}`}
                        style={file.missing.length > 0 ? { display: 'block' } : undefined}
                      >
                        En cours de contrôle
                      </span>
                      <ul className="checklist checklist--muted mt-10">
                        {file.awaiting.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div className="auth__error mt-16" role="alert">
                  {error.message}
                </div>
              ) : null}

              {file.status === 'DRAFT' ? (
                <div className="panel pad mt-16">
                  <span className="label label--ink">Transmettre à Bail</span>
                  <p className="p-sm mt-8">
                    Le contrôle prend moins de 24 h. Vous pourrez continuer à
                    modifier vos pièces ensuite.
                  </p>
                  <button
                    type="button"
                    className="btn btn-block mt-12"
                    onClick={submit}
                    disabled={pending || file.missing.length > 0}
                  >
                    {pending ? 'Envoi…' : 'Transmettre mon dossier'}
                  </button>
                  {file.missing.length > 0 ? (
                    <p className="field__hint mt-8">
                      Complétez d’abord ce qui est listé ci-dessus.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="panel mt-16">
                <div
                  className="pad-sm"
                  style={{ borderBottom: '1px solid var(--line-softer)' }}
                >
                  <div className="flex jc-b ai-c gap-12 wrap">
                    <span className="label label--ink">Journal de vérification</span>
                    {file.verificationDriver === 'mock' ? (
                      <span className="badge badge--pending badge--nodot">
                        Prestataire simulé
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="pad-sm">
                  <div className="log">
                    {file.journal.map((entry, index) => (
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
                  {file.verificationDriver === 'mock' ? (
                    <p className="field__hint mt-12">
                      Aucun prestataire de vérification n’est encore branché :
                      les contrôles affichés ici sont simulés.
                    </p>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
