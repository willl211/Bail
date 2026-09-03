'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FeeBenchmark, FeesView, PaymentStatus } from '@/lib/api';
import * as fmt from '@/lib/format';
import { startFeePayment, type FeesFailure } from '@/lib/fees-client';

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Paiement en attente', tone: 'badge badge--pending' },
  AUTHORIZED: { label: 'Autorisé', tone: 'badge badge--pending' },
  PAID: { label: 'Réglé', tone: 'badge badge--ok' },
  FAILED: { label: 'Échec', tone: 'badge badge--reject' },
  REFUNDED: { label: 'Remboursé', tone: 'badge badge--mute' },
  CANCELLED: { label: 'Annulé', tone: 'badge badge--mute' },
};

/**
 * Comparatif des honoraires.
 *
 * Le repère haut n'est pas un chiffre inventé : c'est le **plafond légal**
 * (décret n° 2014-890), auquel les agences facturent le plus souvent. Le
 * comparatif se lit donc contre une borne vérifiable, pas contre une
 * estimation flatteuse.
 */
function FeeComparison({ benchmark }: { benchmark: FeeBenchmark }) {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Le repère « agence » n'apparaît que s'il diffère du plafond : tant qu'il y
  // est calé, deux barres identiques ne diraient rien de plus.
  const rows = [
    {
      key: 'cap',
      label: 'Plafond légal',
      cents: benchmark.legalCapCents,
    },
    ...(benchmark.agencyCents !== benchmark.legalCapCents
      ? [{ key: 'agency', label: 'Agence classique', cents: benchmark.agencyCents }]
      : []),
    { key: 'bail', label: 'Bail', cents: benchmark.platformCents, us: true },
  ];
  const ceiling = Math.max(...rows.map((row) => row.cents), 1);

  return (
    <div className="panel pad">
      <div>
        {rows.map((row) => (
          <div key={row.key} className="cmp">
            <span className={`cmp__k${row.us ? ' accent' : ''}`}>{row.label}</span>
            <div className="cmp__t">
              <span
                className={`cmp__f${row.us ? ' cmp__f--us' : ''}`}
                style={{ transform: `scaleX(${drawn ? row.cents / ceiling : 0})` }}
              />
            </div>
            <span className={`cmp__v${row.us ? ' accent' : ''}`}>
              {fmt.euros(row.cents)}
            </span>
          </div>
        ))}
      </div>
      <p className="field__hint mt-12">
        Pour ce logement précis. Le plafond légal est celui de la zone non tendue
        (décret n° 2014-890) — c’est le maximum qu’une agence peut facturer, et
        c’est ce qu’elles facturent le plus souvent. Un repère « agence en ligne »
        a été écarté : aucune donnée fiable ne le fonde.
      </p>
    </div>
  );
}

/**
 * Règlement des honoraires — écran 7.
 *
 * Aucun champ de carte bancaire, contrairement à la maquette : les coordonnées
 * bancaires ne doivent jamais transiter par Bail. C'est le prestataire qui les
 * collecte, dans son propre cadre — ce qui nous tient hors du périmètre
 * PCI-DSS. Reproduire le formulaire de la maquette aurait été une faute.
 */
export function FeesScreen({ initial }: { initial: FeesView }) {
  const [fees, setFees] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FeesFailure | null>(null);

  const blocked = fees.blockers.length > 0;
  const paid = fees.payment?.status === 'PAID';

  const pay = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await startFeePayment(fees.leaseReference);
      setFees(result.view);
    } catch (failure) {
      setError(failure as FeesFailure);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="page__head">
        <div>
          <span className="label label--accent">
            Honoraires · {fees.leaseReference}
          </span>
          <h1 className="d3 mt-8">Régler les honoraires</h1>
        </div>
        <span
          className={
            fees.payment ? PAYMENT_STATUS[fees.payment.status].tone : 'badge badge--pending'
          }
        >
          {fees.payment
            ? PAYMENT_STATUS[fees.payment.status].label
            : 'Paiement en attente'}
        </span>
      </div>

      <div className="split split--wide mt-24">
        <div>
          <div className="panel panel--strong tick">
            <div className="pad" style={{ borderBottom: '1px solid var(--line-softer)' }}>
              <span className="label label--ink">Détail · part locataire</span>
              <p className="p-sm mt-6">
                Annoncé avant votre candidature. Une seule fois, à la signature.
              </p>
            </div>

            {fees.lines.map((line) => (
              <div key={line.key} className="pay__line">
                <span className="pay__k">
                  {line.label}
                  <span className="doc__m">
                    {line.detail} · plafond légal {fmt.euros(line.legalCapCents)}
                  </span>
                </span>
                <span className="pay__v">{fmt.eurosPrecise(line.amountCents)}</span>
              </div>
            ))}

            <div className="pay__line">
              <span className="pay__k muted">
                Part propriétaire
                <span className="doc__m">
                  Aucune : le propriétaire paie un abonnement, pas de commission
                </span>
              </span>
              <span className="pay__v muted">
                {fmt.eurosPrecise(fees.ownerShareCents)}
              </span>
            </div>

            <div className="pay__line pay__line--total">
              <div>
                <span className="label label--accent">Total à régler</span>
                <div className="p-sm mt-4">
                  {fmt.surfaceLower(fees.surfaceM2)} ×{' '}
                  {(fees.centsPerSqm / 100).toLocaleString('fr-FR')} €/m² · TVA incluse
                </div>
              </div>
              <span className="pay__total">{fmt.eurosPrecise(fees.totalCents)}</span>
            </div>
          </div>

          {fees.benchmark ? (
            <>
              <h2 className="h mt-32 mb-12">Ce que ça représente</h2>
              <FeeComparison benchmark={fees.benchmark} />
            </>
          ) : null}

          <h2 className="h mt-32 mb-12">Moyen de paiement</h2>
          <div className="panel pad">
            <div className="flex ai-c gap-12 wrap">
              <span className="mono-av">CB</span>
              <div>
                <div className="h-sm">Carte bancaire</div>
                <div className="doc__m">
                  Saisie chez le prestataire de paiement, jamais sur Bail
                </div>
              </div>
            </div>
            <p className="p-sm mt-12">
              Vos coordonnées bancaires ne transitent pas par nos serveurs : elles
              sont collectées par le prestataire, dans son propre formulaire
              sécurisé. Bail ne les voit ni ne les conserve.
            </p>
            {fees.paymentDriver === 'mock' ? (
              <p className="field__hint mt-10">
                <span className="badge badge--pending badge--nodot">
                  Prestataire simulé
                </span>{' '}
                Aucun compte de paiement n’est branché : aucun règlement ne peut
                aboutir, et aucun montant n’est prélevé.
              </p>
            ) : null}
          </div>
        </div>

        <aside>
          <div className="panel panel--strong">
            <div className="pad" style={{ borderBottom: '1px solid var(--line-softer)' }}>
              <span className="label label--ink">À régler aujourd’hui</span>
              <div className="flex ai-c gap-10 mt-10">
                <span className="pay__total" style={{ fontSize: 34 }}>
                  {fmt.euros(fees.totalCents)}
                </span>
              </div>
              <p className="p-sm mt-6">Honoraires locataire, une seule fois.</p>
            </div>

            <div className="pad">
              <div className="kv">
                <span className="kv__k">Dépôt de garantie</span>
                <span className="kv__v">
                  {fmt.euros(fees.depositCents)} · {fmt.availability(fees.moveInDate, false)}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">Premier loyer</span>
                <span className="kv__v">
                  {fmt.euros(fees.firstRentCents)} ·{' '}
                  {fmt.availability(fees.moveInDate, false)}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">Total à l’entrée</span>
                <span className="kv__v">{fmt.euros(fees.moveInTotalCents)}</span>
              </div>
            </div>

            <div className="pad wash" style={{ borderTop: '1px solid var(--line-softer)' }}>
              {error ? (
                <div className="auth__error mb-12" role="alert">
                  {error.message}
                </div>
              ) : null}

              {paid ? (
                <p className="p-sm">
                  Honoraires réglés
                  {fees.payment?.paidAt ? ` le ${fmt.logStamp(fees.payment.paidAt)}` : ''}. Une
                  facture nominative est disponible dans votre espace.
                </p>
              ) : blocked ? (
                <>
                  <span className="label label--ink">Règlement indisponible</span>
                  <ul className="checklist mt-10">
                    {fees.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                  <Link
                    href={`/baux/${fees.leaseReference}`}
                    className="btn btn--ghost btn-block btn-sm mt-12"
                  >
                    Voir le bail
                  </Link>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-block"
                    onClick={pay}
                    disabled={pending}
                  >
                    {pending ? 'Ouverture…' : `Payer ${fmt.euros(fees.totalCents)}`}
                  </button>
                  <p className="field__hint mt-10">
                    Vous serez redirigé vers le prestataire pour saisir votre carte.
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="panel mt-16">
            <div className="pad-sm" style={{ borderBottom: '1px solid var(--line-softer)' }}>
              <span className="label label--ink">Suivi du paiement</span>
            </div>
            <div className="pad-sm">
              <div className="log">
                <div
                  className={`log__entry log__entry--${paid ? 'ok' : 'pending'}`}
                >
                  <span className="log__date">{paid ? 'Réglé' : 'En attente'}</span>
                  <div>
                    <span className="log__title">Honoraires locataire</span>
                    <span className="log__note">
                      {fmt.euros(fees.totalCents)} · carte bancaire
                    </span>
                  </div>
                </div>
                <div className="log__entry">
                  <span className="log__date">Puis</span>
                  <div>
                    <span className="log__title">Dépôt de garantie</span>
                    <span className="log__note">
                      Encaissé pour le compte du bailleur
                    </span>
                  </div>
                </div>
                <div className="log__entry">
                  <span className="log__date">Puis</span>
                  <div>
                    <span className="log__title">Reversement au propriétaire</span>
                    <span className="log__note">Sous 5 jours ouvrés</span>
                  </div>
                </div>
                <div className="log__entry">
                  <span className="log__date">
                    {fmt.availability(fees.moveInDate, false)}
                  </span>
                  <div>
                    <span className="log__title">Remise des clés</span>
                    <span className="log__note">État des lieux d’entrée</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {fees.feeScheduleCode && !fees.feeScheduleApproved ? (
            <div className="panel pad mt-16 wash">
              <span className="label label--accent">Barème provisoire</span>
              <p className="p-sm mt-8">
                Le barème appliqué ({fees.feeScheduleCode}) est celui du pilote Metz. Il
                n’est pas encore validé juridiquement : aucun montant n’est encaissé
                tant qu’il ne l’est pas.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
