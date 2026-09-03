'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { LeaseCheck, LeaseStatus, LeaseView, RenderedBlock } from '@/lib/api';
import * as fmt from '@/lib/format';
import { sendLeaseForSignature, type LeaseFailure } from '@/lib/lease-client';

const STATUS: Record<LeaseStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Brouillon', tone: 'badge badge--mute' },
  FIELDS_VALIDATED: { label: 'Champs vérifiés', tone: 'badge badge--pending' },
  SENT_FOR_SIGNATURE: { label: 'En attente de signature', tone: 'badge badge--pending' },
  PARTIALLY_SIGNED: { label: 'Signé par une partie', tone: 'badge badge--pending' },
  SIGNED: { label: 'Signé', tone: 'badge badge--ok' },
  DECLINED: { label: 'Refusé', tone: 'badge badge--reject' },
  EXPIRED: { label: 'Expiré', tone: 'badge badge--mute' },
  CANCELLED: { label: 'Annulé', tone: 'badge badge--mute' },
};

const CHECK_TONE: Record<LeaseCheck['status'], string> = {
  CONFORME: 'badge badge--ok',
  ANOMALIE: 'badge badge--reject',
  NON_VERIFIABLE: 'badge badge--pending',
};

const CHECK_LABEL: Record<LeaseCheck['status'], string> = {
  CONFORME: 'Conforme',
  ANOMALIE: 'Anomalie',
  NON_VERIFIABLE: 'Non vérifiable',
};

/** Étapes du parcours, de la génération à la remise des clés. */
function flowSteps(lease: LeaseView) {
  const signedCount = lease.signers.filter((signer) => signer.signed).length;
  const checksDone = lease.validation !== null;
  const clean = lease.blockers.length === 0;
  const sent = lease.sentForSignatureAt !== null;

  return [
    {
      n: '01',
      title: 'Modèle choisi',
      detail: `${lease.type === 'MEUBLE' ? 'Bail meublé' : 'Bail nu'} · loi 89-462`,
      state: 'done' as const,
    },
    {
      n: '02',
      title: 'Champs injectés',
      detail: lease.validation
        ? `${lease.validation.fieldCount - lease.validation.missingFields.length} / ${lease.validation.fieldCount}`
        : '—',
      state: (lease.validation?.missingFields.length === 0 ? 'done' : 'now') as
        | 'done'
        | 'now',
    },
    {
      n: '03',
      title: 'Cohérence vérifiée',
      detail: !checksDone
        ? '—'
        : clean
          ? 'Aucune anomalie'
          : `${lease.blockers.length} point(s) à lever`,
      state: (clean ? 'done' : 'next') as 'done' | 'next',
    },
    {
      n: '04',
      title: 'Signature',
      detail: sent ? `${signedCount} / 2 signée` : 'Pas encore envoyée',
      state: (lease.status === 'SIGNED' ? 'done' : sent ? 'now' : 'next') as
        | 'done'
        | 'now'
        | 'next',
    },
    {
      n: '05',
      title: 'Honoraires',
      detail: 'Après signature',
      state: 'next' as const,
    },
    {
      n: '06',
      title: 'Remise des clés',
      detail: fmt.availability(lease.startDate, false),
      state: 'next' as const,
    },
  ];
}

/** Un bloc du document : titre de section, ou paragraphe avec valeurs injectées. */
function DocumentBlock({ block }: { block: RenderedBlock }) {
  const content = block.segments.map((segment, index) =>
    segment.field === null ? (
      <span key={index}>{segment.text}</span>
    ) : (
      <span
        key={index}
        // Un marqueur resté tel quel est un champ vide : signalé, pas masqué.
        className={
          segment.text.startsWith('{{') ? 'slotv slotv--empty' : 'slotv'
        }
        title={`Champ injecté : ${segment.field}`}
      >
        {segment.text}
      </span>
    ),
  );

  if (block.heading > 0) {
    return (
      <div className="deed__art">
        <h4>{content}</h4>
      </div>
    );
  }
  return (
    <div className="deed__art">
      <p>{content}</p>
    </div>
  );
}

/**
 * Bail et signature électronique — écran 6.
 *
 * Le document affiché distingue le texte légal verrouillé des valeurs
 * injectées : ce qui est surligné vient du dossier, le reste vient du modèle.
 * C'est ainsi que la règle « la plateforme ne rédige aucune clause » se
 * vérifie à l'œil, au lieu d'être seulement affirmée (CLAUDE.md règle 2).
 */
export function LeaseScreen({
  initial,
  canSend,
}: {
  initial: LeaseView;
  /** Seul le propriétaire du bien envoie l'acte en signature. */
  canSend: boolean;
}) {
  const router = useRouter();
  const [lease, setLease] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LeaseFailure | null>(null);

  const status = STATUS[lease.status];
  const blocked = lease.blockers.length > 0;

  const send = async () => {
    setPending(true);
    setError(null);
    try {
      setLease(await sendLeaseForSignature(lease.reference));
      router.refresh();
    } catch (failure) {
      setError(failure as LeaseFailure);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="page__head">
        <div>
          <span className="label label--accent">
            Bail {lease.reference} · {lease.propertyReference}
          </span>
          <h1 className="d3 mt-8">
            Bail d’habitation — logement {lease.type === 'MEUBLE' ? 'meublé' : 'nu'}
          </h1>
        </div>
        <div className="flex gap-10 ai-c wrap">
          <span className={status.tone}>{status.label}</span>
        </div>
      </div>

      <div className="flow mt-24">
        {flowSteps(lease).map((step) => (
          <div key={step.n} className={`flow__s flow__s--${step.state}`}>
            <div className="flow__n">{step.n}</div>
            <div className="flow__t">{step.title}</div>
            <div className="flow__d">{step.detail}</div>
          </div>
        ))}
      </div>

      <div className="split split--wide mt-32">
        <div>
          <div className="deed">
            <div className="deed__head">
              <div>
                <span className="label label--ink">
                  Modèle légal {lease.templatePublished ? 'verrouillé' : 'non publié'} ·{' '}
                  {lease.templateCode} v{lease.templateVersion}
                </span>
                <div className="h mt-8">{lease.templateLabel}</div>
                <p className="p-sm mt-6">
                  Aucune clause rédigée par la plateforme. Les champs surlignés sont
                  injectés depuis les dossiers, puis contrôlés.
                </p>
              </div>
              <span
                className={
                  lease.templatePublished
                    ? 'badge badge--ok badge--nodot'
                    : 'badge badge--reject badge--nodot'
                }
              >
                {lease.templatePublished ? 'Non modifiable' : 'Texte en attente'}
              </span>
            </div>

            <div className="deed__body">
              {lease.document.map((block, index) => (
                <DocumentBlock key={index} block={block} />
              ))}
            </div>

            <div className="deed__foot">
              <span className="label">
                {lease.validation
                  ? `${lease.validation.fieldCount} champs · ${lease.annexes.filter((annexe) => annexe.present).length} annexe(s) · 2 signataires`
                  : '2 signataires'}
              </span>
              <Link href={`/biens/${lease.propertyReference}`} className="link link--accent">
                Revoir l’annonce →
              </Link>
            </div>
          </div>

          {!lease.templatePublished ? (
            <div
              className="panel pad mt-16"
              style={{
                borderColor: 'var(--amber-border-soft)',
                background: 'var(--amber-tint)',
              }}
            >
              <div className="flex gap-12" style={{ alignItems: 'flex-start' }}>
                <span className="badge badge--pending badge--nodot">Avis</span>
                <p className="p-sm" style={{ color: 'var(--ink-2)' }}>
                  Le texte affiché est un <b>squelette de champs</b>, pas un contrat : il ne
                  contient aucune clause. Le modèle définitif sera fourni par l’avocat en
                  droit immobilier, puis publié. Jusque-là, aucun bail ne peut partir en
                  signature — un acte sans clauses n’engagerait personne.
                </p>
              </div>
            </div>
          ) : null}

          <h2 className="h mt-32 mb-12">Contrôle de cohérence</h2>
          {lease.validation === null ? (
            <div className="panel pad">
              <p className="p-sm">Aucun contrôle n’a encore été mené.</p>
            </div>
          ) : (
            <>
              <div className="panel panel--strong">
                {lease.validation.checks.map((check) => (
                  <div key={check.key} className="doc">
                    <div className="doc__head">
                      <div>
                        <div className="doc__n">{check.label}</div>
                        <div className="doc__m">{check.detail}</div>
                      </div>
                      <div className="doc__c">{check.message ?? check.source}</div>
                      <div className="doc__a">
                        <span className={CHECK_TONE[check.status]}>
                          {CHECK_LABEL[check.status]}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="field__hint mt-10">
                Ces contrôles comparent les valeurs injectées à leur source en base. Ils ne
                produisent aucun texte : la plateforme vérifie, elle ne rédige pas.
              </p>
            </>
          )}
        </div>

        <aside>
          <div className="panel panel--strong tick">
            <div className="pad" style={{ borderBottom: '1px solid var(--line-softer)' }}>
              <span className="label label--ink">Signature électronique</span>
              <p className="p-sm mt-8">
                {lease.sentForSignatureAt
                  ? `Envoyée le ${fmt.logStamp(lease.sentForSignatureAt)} · valable 7 jours.`
                  : 'Pas encore envoyée aux signataires.'}
              </p>
            </div>

            <div className="sig">
              {lease.signers.map((signer) => (
                <div key={signer.role} className="sig__c">
                  <span className={signer.signed ? 'badge badge--ok' : 'badge badge--pending'}>
                    {signer.signed ? 'Signée' : 'En attente'}
                  </span>
                  <div className="sig__name">{signer.fullName}</div>
                  <div className="sig__role">
                    {signer.role === 'LANDLORD' ? 'Bailleur' : 'Locataire'}
                    {signer.signedAt ? ` · ${fmt.logStamp(signer.signedAt)}` : ' · à signer'}
                  </div>
                </div>
              ))}
            </div>

            <div className="pad wash" style={{ borderTop: '1px solid var(--line-softer)' }}>
              {error ? (
                <div className="auth__error mb-12" role="alert">
                  {error.message}
                </div>
              ) : null}

              {blocked ? (
                <>
                  <span className="label label--ink">Envoi impossible</span>
                  <ul className="checklist mt-10">
                    {lease.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </>
              ) : canSend && lease.sentForSignatureAt === null ? (
                <>
                  <button
                    type="button"
                    className="btn btn-block"
                    onClick={send}
                    disabled={pending}
                  >
                    {pending ? 'Envoi…' : 'Envoyer en signature'}
                  </button>
                  <p className="field__hint mt-10">
                    Les deux parties recevront un lien de signature valable 7 jours.
                  </p>
                </>
              ) : (
                <>
                  <p className="p-sm">
                    {lease.status === 'SIGNED'
                      ? 'Bail signé par les deux parties.'
                      : 'En attente de la signature des parties.'}
                  </p>
                  {/* Les honoraires se règlent après signature : le lien
                      n'apparaît qu'une fois l'acte signé, et l'écran de
                      règlement refuse de toute façon avant. */}
                  {lease.status === 'SIGNED' && !canSend ? (
                    <Link
                      href={`/baux/${lease.reference}/honoraires`}
                      className="btn btn-block mt-12"
                    >
                      Régler les honoraires
                    </Link>
                  ) : null}
                </>
              )}

              {lease.signatureDriver === 'mock' ? (
                <p className="field__hint mt-10">
                  <span className="badge badge--pending badge--nodot">
                    Prestataire simulé
                  </span>{' '}
                  Aucun compte de signature n’est branché : rien de ce qui est signé ici
                  n’a de valeur juridique.
                </p>
              ) : null}
            </div>
          </div>

          <div className="panel mt-16">
            <div className="pad-sm" style={{ borderBottom: '1px solid var(--line-softer)' }}>
              <span className="label label--ink">Historique du document</span>
            </div>
            <div className="pad-sm">
              <div className="log">
                {lease.history.map((entry, index) => (
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
            </div>
          </div>

          <div className="panel mt-16 pad">
            <span className="label label--ink">Annexes obligatoires</span>
            <div className="mt-10">
              {lease.annexes.map((annexe) => (
                <div key={annexe.type} className="kv">
                  <span className="kv__k">{annexe.label}</span>
                  <span className="kv__v">
                    <span
                      className={
                        annexe.present
                          ? 'badge badge--ok badge--nodot'
                          : 'badge badge--mute badge--nodot'
                      }
                    >
                      {annexe.detail}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="field__hint mt-10">
              Les diagnostics se déposent depuis la fiche du bien, côté propriétaire.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
