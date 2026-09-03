import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CostComparison } from '@/components/cost-comparison';
import { OwnerAside } from '@/components/owner-aside';
import { SubscriptionActions } from '@/components/subscription-actions';
import { getCurrentUser, getOwnerSummary, getSubscription } from '@/lib/api';
import type { PaymentStatus, SubscriptionStatus } from '@/lib/api';
import * as fmt from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Abonnement' };

/** Statut de l'abonnement, tel qu'affiché en tête de la formule. */
const PLAN_BADGE: Record<SubscriptionStatus, { label: string; tone: string }> = {
  TRIALING: { label: 'Période d’essai', tone: 'badge badge--pending' },
  ACTIVE: { label: 'Actif', tone: 'badge badge--ok' },
  PAST_DUE: { label: 'Paiement en retard', tone: 'badge badge--reject' },
  CANCELLED: { label: 'Résilié', tone: 'badge badge--mute' },
};

/** Statut d'une échéance dans l'historique. */
const INVOICE_BADGE: Record<PaymentStatus, { label: string; tone: string }> = {
  PENDING: { label: 'À venir', tone: 'badge badge--pending' },
  AUTHORIZED: { label: 'Autorisé', tone: 'badge badge--pending' },
  PAID: { label: 'Payé', tone: 'badge badge--ok' },
  FAILED: { label: 'Échec', tone: 'badge badge--reject' },
  REFUNDED: { label: 'Remboursé', tone: 'badge badge--mute' },
  CANCELLED: { label: 'Annulé', tone: 'badge badge--mute' },
};

export default async function OwnerSubscriptionPage() {
  const user = await getCurrentUser();
  // Le contrôle qui compte est le guard de rôle côté API ; cette redirection
  // évite seulement d'afficher un écran vide.
  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');

  const [summary, subscription] = await Promise.all([
    getOwnerSummary(),
    getSubscription(),
  ]);

  const cancelled = subscription.cancelledAt !== null;
  const state =
    subscription.status === null || subscription.status === 'CANCELLED'
      ? 'none'
      : cancelled
        ? 'cancelled'
        : 'active';

  const badge =
    subscription.status === null
      ? { label: 'Aucun abonnement', tone: 'badge badge--mute' }
      : cancelled
        ? { label: 'Résiliation en cours', tone: 'badge badge--pending' }
        : PLAN_BADGE[subscription.status];

  const nextCharge = subscription.nextChargeAt
    ? fmt.longDate(subscription.nextChargeAt)
    : null;

  const plural = subscription.billableCount > 1 ? 's' : '';

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="app">
        <OwnerAside user={user} summary={summary} current="subscription" />

        <div className="body">
          <div className="page__head">
            <div>
              <span className="label label--accent">Facturation</span>
              <h1 className="d3 mt-8">Abonnement</h1>
            </div>

            <div className="stats">
              <div>
                <span className="label">Biens facturés</span>
                <div className="stat__value">{subscription.billableCount}</div>
              </div>
              <div>
                <span className="label">Ce mois</span>
                <div className="stat__value">
                  {fmt.euros(subscription.monthlyTotalCents)}
                </div>
              </div>
              <div>
                <span className="label">Commission</span>
                <div className="stat__value accent">0 €</div>
              </div>
            </div>
          </div>

          <div className="split mt-24">
            <div>
              <div className="panel panel--strong tick">
                <div
                  className="pad flex jc-b gap-16 wrap"
                  style={{
                    borderBottom: '1px solid var(--line-softer)',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <span className="label label--accent">Formule</span>
                    <div className="d3 mt-8">{subscription.planLabel}</div>
                    <p className="p-sm mt-6">
                      {subscription.unitAmountCents === null
                        ? 'Aucun barème actif ne définit encore le montant.'
                        : `${fmt.eurosPrecise(subscription.unitAmountCents)} par bien diffusé et par mois. Aucune commission sur le loyer.`}
                    </p>
                  </div>
                  <span className={badge.tone}>{badge.label}</span>
                </div>

                {subscription.lines.length === 0 ? (
                  <div className="pay__line">
                    <span className="pay__k">
                      Aucun bien au portefeuille : rien n’est facturé.
                    </span>
                  </div>
                ) : (
                  subscription.lines.map((line) => (
                    <div key={line.reference} className="pay__line">
                      <span className={`pay__k${line.billed ? '' : ' muted'}`}>
                        {line.reference} — {line.label}
                        {line.billed ? '' : ` · ${line.statusLabel}`}
                      </span>
                      <span className={`pay__v${line.billed ? '' : ' muted'}`}>
                        {fmt.eurosPrecise(line.amountCents)}
                      </span>
                    </div>
                  ))
                )}

                <div className="pay__line pay__line--total">
                  <div>
                    <span className="label label--accent">
                      {subscription.status === null
                        ? 'Coût mensuel estimé'
                        : cancelled
                          ? `Dernier prélèvement${nextCharge ? ` · ${nextCharge}` : ''}`
                          : `Prochain prélèvement${nextCharge ? ` · ${nextCharge}` : ''}`}
                    </span>
                    <div className="p-sm mt-4">
                      {/* Une seule expression : découper la phrase entre plusieurs
                          accolades ferait apparaître une espace avant le « s ». */}
                      {`${subscription.billableCount} bien${plural} diffusé${plural}`}
                      {subscription.unitAmountCents === null
                        ? ''
                        : ` × ${fmt.eurosPrecise(subscription.unitAmountCents)}`}
                    </div>
                  </div>
                  <span className="pay__total">
                    {fmt.eurosPrecise(subscription.monthlyTotalCents)}
                  </span>
                </div>
              </div>

              {state === 'none' ? (
                <div className="panel pad mt-16">
                  <SubscriptionActions state="none" endsAt={null} />
                  <p className="field__hint mt-12">
                    Sans engagement, résiliable à tout moment. La facturation démarre
                    quand une annonce passe en diffusion.
                  </p>
                </div>
              ) : null}

              <h2 className="h mt-32 mb-12">Moyen de paiement</h2>
              {subscription.paymentMethod === null ? (
                <div className="panel pad">
                  <p className="p-sm">
                    Aucun moyen de paiement : il sera demandé à la souscription.
                  </p>
                </div>
              ) : (
                <div className="panel pad">
                  <div className="flex jc-b ai-c gap-16 wrap">
                    <div className="flex ai-c gap-12">
                      <span className="mono-av">CB</span>
                      <div>
                        <div className="h-sm">
                          {subscription.paymentMethod.brand} •••• {subscription.paymentMethod.last4}
                        </div>
                        <div className="aside__meta">
                          Expire {subscription.paymentMethod.expiry} ·{' '}
                          {subscription.paymentMethod.holder}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-10 ai-c wrap">
                      <span className="badge badge--pending badge--nodot">
                        {subscription.paymentMethod.simulated
                          ? 'Prestataire simulé'
                          : 'Stripe · mode test'}
                      </span>
                      <button className="btn btn--ghost btn-sm" type="button" disabled>
                        Modifier
                      </button>
                    </div>
                  </div>
                  {subscription.paymentMethod.simulated ? (
                    <p className="field__hint mt-12">
                      Aucun compte de paiement n’est encore branché : cette carte est
                      celle du jeu d’essai, aucun prélèvement réel n’a lieu.
                    </p>
                  ) : null}
                </div>
              )}

              <h2 className="h mt-32 mb-12">Historique</h2>
              {subscription.invoices.length === 0 ? (
                <div className="panel pad">
                  <p className="p-sm">
                    Aucune échéance pour l’instant. La première apparaîtra ici dès la
                    souscription.
                  </p>
                </div>
              ) : (
                <div className="tbl__scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Période</th>
                        <th>Référence</th>
                        <th>Biens</th>
                        <th className="r">Montant</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscription.invoices.map((invoice) => {
                        const tone = INVOICE_BADGE[invoice.status];
                        return (
                          <tr key={invoice.id}>
                            <td className="n">{invoice.period}</td>
                            <td className="n">{invoice.reference}</td>
                            <td className="n">{invoice.propertyCount}</td>
                            <td className="r n">{fmt.eurosPrecise(invoice.amountCents)}</td>
                            <td>
                              <span className={tone.tone}>{tone.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <aside>
              {subscription.benchmark ? (
                <CostComparison benchmark={subscription.benchmark} />
              ) : null}

              {state !== 'none' ? (
                <div className={`panel pad${subscription.benchmark ? ' mt-16' : ''}`}>
                  <span className="label label--ink">
                    {state === 'cancelled' ? 'Résiliation enregistrée' : 'Résiliation'}
                  </span>
                  <p className="p-sm mt-8">
                    {state === 'cancelled'
                      ? `Vos annonces sortent de la diffusion${nextCharge ? ` le ${nextCharge}` : ' à la fin de la période en cours'}. Vous pouvez encore revenir en arrière.`
                      : 'Sans engagement. Elle prend effet à la fin de la période en cours ; vos annonces sont retirées et vos baux signés restent accessibles.'}
                  </p>
                  <SubscriptionActions state={state} endsAt={nextCharge} />
                </div>
              ) : null}

              <div className="panel pad mt-16 wash">
                <span className="label label--accent">Barème paramétrable</span>
                <p className="p-sm mt-8">
                  Le montant de l’abonnement et le barème d’honoraires locataire se
                  règlent depuis le back-office, sans redéploiement.
                  {subscription.feeScheduleCode
                    ? ` Barème appliqué : ${subscription.feeScheduleCode}.`
                    : ''}
                </p>
                {subscription.feeScheduleCode && !subscription.feeScheduleApproved ? (
                  <p className="field__hint mt-8">
                    Ce barème n’est pas encore validé juridiquement : les montants
                    affichés sont ceux du pilote Metz, à figer avant toute facturation
                    réelle.
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
