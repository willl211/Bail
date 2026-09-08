import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountRegistrationForm } from '@/components/account-registration-form';
import { AuthScenery } from '@/components/auth-scenery';
import { getCurrentUser, getMarketSnapshot, getOwnerSubscriptionPricing } from '@/lib/api';
import * as fmt from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Créer mon espace propriétaire',
  description:
    'Publiez votre bien à Metz avec un abonnement mensuel, sans commission sur le loyer. Dossiers vérifiés, bail et signature inclus.',
};

const BENEFITS = [
  {
    n: '01',
    title: '39 € par mois et par bien',
    text: 'Sans engagement. Aucune commission sur le loyer.',
  },
  {
    n: '02',
    title: 'Des dossiers déjà vérifiés',
    text: 'Une synthèse, pas une pile de PDF.',
  },
  {
    n: '03',
    title: 'Bail et signature inclus',
    text: 'Modèle légal verrouillé, signé en ligne par les deux parties.',
  },
  {
    n: '04',
    title: 'Visites organisées pour vous',
    text: 'Un agent s’en charge, sur place ou en visio.',
  },
];

/**
 * Page d'acquisition propriétaire — **publique**.
 *
 * « Espace propriétaire » recouvre deux choses : cette page, accessible sans
 * compte et indexable, et le tableau de bord authentifié (`/proprietaires/biens`).
 * Un propriétaire déjà connecté n'a rien à faire ici : il est renvoyé vers son
 * portefeuille.
 */
export default async function OwnersPage() {
  const user = await getCurrentUser();
  if (user?.role === 'OWNER') redirect('/proprietaires/biens');
  if (user?.role === 'TENANT') redirect('/dossier');
  if (user?.role === 'AGENT') redirect('/back-office');

  const [subscription, market] = await Promise.all([
    getOwnerSubscriptionPricing().catch(() => null),
    getMarketSnapshot().catch(() => null),
  ]);

  const onlineCount = market?.verifiedPropertyCount ?? null;

  return (
    <main className="page">
      <div className="auth auth--welcome">
        <div className="auth__form">
          <span className="label label--accent">Espace propriétaire</span>
          <h1 className="d2 mt-12">Votre bien, entre vos mains.</h1>

          <p className="p mt-16">
            Créez votre espace propriétaire pour publier un logement et suivre vos
            candidatures.
          </p>
          <AccountRegistrationForm role="OWNER" />
        </div>

        <AuthScenery title="Louer, l’esprit tranquille.">
          <span className="label label--ink">Ce que vous obtenez</span>
          <div className="mt-16" style={{ maxWidth: 440 }}>
            {BENEFITS.map((benefit) => (
              <div key={benefit.n} className="bullet">
                <span className="bullet__i">{benefit.n}</span>
                <div>
                  <div className="h-sm">
                    {benefit.n === '01' &&
                    subscription?.monthlyAmountCents !== null &&
                    subscription?.monthlyAmountCents !== undefined
                      ? `${fmt.euros(subscription.monthlyAmountCents)} par mois et par bien`
                      : benefit.title}
                  </div>
                  <p className="p-sm mt-6">{benefit.text}</p>
                </div>
              </div>
            ))}
          </div>

          {onlineCount !== null ? (
            <div className="panel mt-24" style={{ maxWidth: 440, padding: '19px 20px' }}>
              <span className="label">Portefeuille Metz</span>
              <div className="stats mt-12">
                <div>
                  <span className="label">Biens en ligne</span>
                  <div className="stat__value">{onlineCount}</div>
                </div>
                {market?.metrics.slice(0, 2).map((metric) => (
                  <div key={metric.key}>
                    <span className="label">{metric.label}</span>
                    <div className="stat__value">{metric.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </AuthScenery>
      </div>
    </main>
  );
}
