'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  ApplicationStatus,
  CandidacyPreview,
  TenantApplicationSummary,
} from '@/lib/api';
import { apply, type ApplicationFailure } from '@/lib/applications-client';
import * as fmt from '@/lib/format';
import { PhotoPlaceholder } from './photo-placeholder';

const STATUS_BADGE: Record<ApplicationStatus, { label: string; tone: string }> = {
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

function EffortGauge({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="muted">—</span>;
  const tone = rate <= 0.33 ? '' : rate <= 0.4 ? ' gauge__fill--pending' : ' gauge__fill--reject';
  return (
    <span className="gauge">
      <span className="gauge__bar">
        <span
          className={`gauge__fill${tone}`}
          style={{ transform: `scaleX(${Math.min(rate, 1)})` }}
        />
      </span>
      {fmt.percent(rate)}
    </span>
  );
}

/**
 * Candidature à un bien — écran 4.
 *
 * Composant client parce que l'envoi doit basculer l'écran en confirmation
 * sans recharger la page. L'aperçu initial, lui, vient du serveur.
 */
export function CandidacyScreen({
  reference,
  initial,
  applications,
}: {
  reference: string;
  initial: CandidacyPreview;
  applications: TenantApplicationSummary[];
}) {
  const router = useRouter();
  const [preview, setPreview] = useState(initial);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApplicationFailure | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      setPreview(await apply(reference, { message: message || undefined }));
      // L'aperçu revient de la réponse, mais pas le suivi des candidatures :
      // il est rendu côté serveur. Sans ce rafraîchissement, la candidature
      // qu'on vient d'envoyer manquerait au tableau juste en dessous.
      router.refresh();
    } catch (failure) {
      setError(failure as ApplicationFailure);
    } finally {
      setPending(false);
    }
  };

  const property = preview.property;
  const file = preview.file;

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="page__head">
        <div>
          <span className="label label--accent">
            Candidature · {property.reference}
          </span>
          <h1 className="d3 mt-8">{property.title}</h1>
        </div>

        <div className="stats">
          <div>
            <span className="label">Loyer CC</span>
            <div className="stat__value">{fmt.euros(property.totalRentCents)}</div>
          </div>
          <div>
            <span className="label">Taux d’effort</span>
            <div className="stat__value accent">
              {preview.effortRate === null ? '—' : fmt.percent(preview.effortRate)}
            </div>
          </div>
          <div>
            <span className="label">Candidats</span>
            <div className="stat__value">{property.applicationCount}</div>
          </div>
        </div>
      </div>

      <div className="split mt-24">
        <div>
          <div className="panel panel--strong tick">
            <div
              className="pad flex jc-b gap-16 wrap"
              style={{ borderBottom: '1px solid var(--line-softer)', alignItems: 'flex-start' }}
            >
              <div>
                <span className="label label--accent">Ce qui part au propriétaire</span>
                <p className="p-sm mt-6">
                  Rien à ressaisir : votre dossier vérifié est joint automatiquement.
                </p>
              </div>
              {preview.blockers.length === 0 ? (
                <span className="badge badge--ok">Dossier compatible</span>
              ) : (
                <span className="badge badge--reject">À compléter</span>
              )}
            </div>

            <div className="pad">
              <div className="kv">
                <span className="kv__k">Identité</span>
                <span className="kv__v">{file.holderName}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Revenus nets mensuels</span>
                <span className="kv__v">
                  {file.netMonthlyIncomeCents === null
                    ? '—'
                    : fmt.euros(file.netMonthlyIncomeCents)}{' '}
                  <span
                    className={`badge badge--${file.incomeVerified ? 'ok' : 'pending'} badge--nodot`}
                  >
                    {file.incomeVerified ? 'Vérifiés' : 'En cours'}
                  </span>
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
                <span className="kv__k">Taux d’effort</span>
                <span className="kv__v">
                  <EffortGauge rate={preview.effortRate} />
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">Garant</span>
                <span className="kv__v">
                  {file.guarantor === null ? (
                    'Aucun'
                  ) : (
                    <>
                      {file.guarantor.label}{' '}
                      <span
                        className={`badge badge--${file.guarantor.verified ? 'ok' : 'pending'} badge--nodot`}
                      >
                        {file.guarantor.verified ? 'Vérifié' : 'Incomplet'}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">Honoraires à prévoir</span>
                <span className="kv__v">
                  {preview.fees === null ? '—' : `${fmt.euros(preview.fees.totalCents)} TTC`}
                </span>
              </div>
            </div>

            <div className="pad wash" style={{ borderTop: '1px solid var(--line-softer)' }}>
              {preview.alreadyApplied ? (
                <>
                  <div className="flex jc-b ai-c gap-16 wrap">
                    <p className="p-sm">
                      {preview.applicationStatus === 'SHORTLISTED'
                        ? 'Votre dossier a été retenu. Choisissez un créneau de visite.'
                        : preview.applicationStatus === 'VISIT_SCHEDULED'
                          ? 'Votre visite est planifiée.'
                          : 'Candidature envoyée. Le propriétaire a été notifié.'}
                    </p>
                    {preview.applicationStatus ? (
                      <span className={STATUS_BADGE[preview.applicationStatus].tone}>
                        {STATUS_BADGE[preview.applicationStatus].label}
                      </span>
                    ) : null}
                  </div>

                  {/* Le rendez-vous n'est proposé qu'une fois le candidat
                      retenu : l'écran de visite le refuserait autrement. */}
                  {preview.applicationStatus === 'SHORTLISTED' ||
                  preview.applicationStatus === 'VISIT_SCHEDULED' ? (
                    <Link
                      href={`/biens/${property.reference}/visite`}
                      className="btn btn-block mt-12"
                    >
                      {preview.applicationStatus === 'SHORTLISTED'
                        ? 'Choisir un créneau de visite'
                        : 'Voir mon rendez-vous'}
                    </Link>
                  ) : null}
                </>
              ) : (
                <>
                  {/* Mention d'information, pas de case à cocher : transmettre
                      cette synthèse est l'objet même du service, pas un
                      traitement accessoire auquel on consentirait
                      (docs/legal-context.md). Une case pré-cochée aurait eu
                      l'apparence d'un consentement sans en avoir la valeur. */}
                  <p className="p-sm">
                    En envoyant, la synthèse ci-dessus est transmise au propriétaire
                    de ce bien. Vos documents, eux, restent chez Bail.
                  </p>

                  <label className="field mt-16">
                    <span className="label label--ink">
                      Message au propriétaire <span className="doc__opt">facultatif</span>
                    </span>
                    <textarea
                      className="field__box"
                      rows={2}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      maxLength={600}
                    />
                  </label>

                  {error ? (
                    <div className="auth__error mt-12" role="alert">
                      {error.message}
                    </div>
                  ) : null}

                  {preview.blockers.length > 0 ? (
                    <ul className="checklist mt-12">
                      {preview.blockers.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="flex gap-12 wrap ai-c mt-16">
                    <button
                      type="button"
                      className="btn"
                      onClick={submit}
                      disabled={pending || preview.blockers.length > 0}
                    >
                      {pending ? 'Envoi…' : 'Envoyer ma candidature'}
                    </button>
                    <span className="label">
                      {preview.averageResponseDelay
                        ? `Réponse moyenne sous ${preview.averageResponseDelay}`
                        : ''}
                    </span>
                  </div>

                  {preview.blockers.length > 0 ? (
                    <p className="field__hint mt-10">
                      <Link href="/dossier" className="link link--accent">
                        Compléter mon dossier →
                      </Link>
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {preview.warnings.length > 0 ? (
            <div
              className="panel pad mt-16"
              style={{ borderColor: 'var(--amber-border-soft)', background: 'var(--amber-tint)' }}
            >
              <div className="flex gap-12" style={{ alignItems: 'flex-start' }}>
                <span className="badge badge--pending badge--nodot">Avis</span>
                <div>
                  {preview.warnings.map((item) => (
                    <p key={item} className="p-sm" style={{ color: 'var(--ink-2)' }}>
                      {item}
                    </p>
                  ))}
                  <Link href="/dossier" className="link link--accent">
                    Compléter le dossier →
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          <h2 className="h mt-32 mb-12">Suivi de mes candidatures</h2>
          {applications.length === 0 ? (
            <div className="panel pad">
              <p className="p-sm">Aucune candidature envoyée pour l’instant.</p>
            </div>
          ) : (
            <div className="tbl__scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Bien</th>
                    <th className="r">Loyer CC</th>
                    <th>Envoyée</th>
                    <th>Étape</th>
                    <th className="r">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => (
                    <tr key={application.id}>
                      <td>
                        <Link
                          href={`/biens/${application.propertyReference}`}
                          className="tbl__pick"
                        >
                          <span>
                            <span className="tbl__name">{application.propertyTitle}</span>
                            <span className="tbl__sub">
                              {application.propertyReference} · {application.district}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="r n">{fmt.euros(application.totalRentCents)}</td>
                      <td className="n">{fmt.relativeAge(application.submittedAt)}</td>
                      <td>{application.stepLabel}</td>
                      <td className="r">
                        <span className={STATUS_BADGE[application.status].tone}>
                          {STATUS_BADGE[application.status].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside>
          <div className="panel">
            <PhotoPlaceholder
              label={`01 · ${property.photoLabel}`}
              className="property-card__photo"
              scale
            />
            <div className="pad">
              <div className="between">
                <span className="h-sm">{property.title}</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {fmt.euros(property.totalRentCents)}
                </span>
              </div>
              <div className="p-sm mt-4">
                {property.addressLine} · {property.reference}
              </div>
              <div className="property-card__specs mt-12">
                <div className="property-card__spec">
                  <span className="label">Surface</span>
                  <div className="property-card__spec-value">
                    {fmt.surfaceLower(property.surfaceM2)}
                  </div>
                </div>
                <div className="property-card__spec">
                  <span className="label">Pièces</span>
                  <div className="property-card__spec-value">{property.rooms}</div>
                </div>
                <div className="property-card__spec">
                  <span className="label">DPE</span>
                  <div className="property-card__spec-value">
                    {fmt.energyRating(property.energyRating)}
                  </div>
                </div>
              </div>
              <Link
                href={`/biens/${property.reference}`}
                className="btn btn--ghost btn-block btn-sm mt-16"
              >
                Revoir l’annonce
              </Link>
            </div>
          </div>

          <div className="panel mt-16">
            <div className="pad-sm" style={{ borderBottom: '1px solid var(--line-softer)' }}>
              <span className="label label--ink">Étapes après l’envoi</span>
            </div>
            <div className="pad-sm">
              <div className="log">
                <div className="log__entry log__entry--ok">
                  <span className="log__date">Immédiat</span>
                  <div>
                    <span className="log__title">Candidature envoyée</span>
                    <span className="log__note">Le propriétaire est notifié</span>
                  </div>
                </div>
                <div className="log__entry log__entry--pending">
                  <span className="log__date">
                    {preview.averageResponseDelay ? `Sous ${preview.averageResponseDelay}` : 'Ensuite'}
                  </span>
                  <div>
                    <span className="log__title">Étude du dossier</span>
                    <span className="log__note">Réponse acceptée ou refusée</span>
                  </div>
                </div>
                <div className="log__entry">
                  <span className="log__date">Puis</span>
                  <div>
                    <span className="log__title">Visite</span>
                    <span className="log__note">Accompagnée ou visio, au choix</span>
                  </div>
                </div>
                <div className="log__entry">
                  <span className="log__date">Puis</span>
                  <div>
                    <span className="log__title">Bail et honoraires</span>
                    <span className="log__note">Signature en ligne, paiement unique</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
