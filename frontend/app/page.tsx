import Link from 'next/link';
import { AnimatedCounter } from '@/components/animated-counter';
import { HeroSearch } from '@/components/hero-search';
import { PropertyCard } from '@/components/property-card';
import { PlanWalkthrough } from '@/components/plan-walkthrough';
import { ActivityTicker, buildTickerItems } from '@/components/activity-ticker';
import {
  getDistricts,
  getFeaturedProperties,
  getMarketSnapshot,
  getOwnerSubscriptionPricing,
  searchProperties,
} from '@/lib/api';
import * as fmt from '@/lib/format';

export const dynamic = 'force-dynamic';

const OWNER_STEPS = [
  {
    n: '01',
    title: 'Décrivez le bien',
    text: 'Photos, diagnostics, critères. En ligne après contrôle.',
  },
  {
    n: '02',
    title: 'Recevez des dossiers vérifiés',
    text: "Le taux d'effort, jamais les pièces brutes.",
  },
  {
    n: '03',
    title: 'Signez le bail en ligne',
    text: 'Modèle légal verrouillé, signature électronique, quittances.',
  },
];

export default async function HomePage() {
  const [featured, districts, market, subscription, all] = await Promise.all([
    getFeaturedProperties(3),
    getDistricts(),
    getMarketSnapshot(),
    getOwnerSubscriptionPricing(),
    searchProperties(new URLSearchParams({ pageSize: '8' })),
  ]);

  return (
    <>
      <main className="page">
        <div className="hero">
          <div>
            <div className="hero__eyebrow anim-rise">
              <i /> Marché pilote — Metz Métropole
            </div>

            <h1 className="hero__title anim-rise anim-rise-1">
              Le dossier une fois.
              <br />
              La candidature en un clic.
            </h1>

            <p className="hero__lead anim-rise anim-rise-2">
              À Metz, un studio part en 48 heures. Votre dossier est déjà vérifié quand
              vous postulez.
            </p>

            <div className="anim-rise anim-rise-3">
              <HeroSearch districts={districts} />
            </div>

            <div className="hero__reassurance anim-rise anim-rise-4">
              <span>Dossier vérifié sous 24 h</span>
              <span>Aucune commission propriétaire</span>
              <span>Honoraires annoncés avant de candidater</span>
            </div>
          </div>

          <aside className="hero__aside anim-rise anim-rise-2">
            <div className="panel panel--strong tick">
              <div className="registry__head">
                <span className="label">Biens vérifiés · Moselle</span>
                <div className="registry__counter">
                  <AnimatedCounter target={market.verifiedPropertyCount} />
                </div>
                <div className="bar mt-12">
                  <span className="bar-fill" />
                </div>
              </div>

              {market.metrics.map((metric) => (
                <div key={metric.key} className="registry__row">
                  <span className="registry__key">{metric.label}</span>
                  <span className="registry__value">{metric.value}</span>
                </div>
              ))}

              <div className="registry__foot">
                <span className="badge badge--ok anim-pop">Vérification automatisée active</span>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Registre d'activité : ce que la plateforme vient de traiter. */}
      <ActivityTicker items={buildTickerItems(all.items)} />

      {/* Le parcours produit, station par station — cliquable. */}
      <PlanWalkthrough />

      <main className="page" style={{ paddingTop: 0 }}>
        <section className="section reveal">
          <div className="section__head">
            <h2 className="section__title">Biens en avant à Metz</h2>
            <Link href="/recherche" className="link link--accent">
              Voir les {market.verifiedPropertyCount} biens en ligne →
            </Link>
          </div>

          <div className="card-grid">
            {featured.map((property) => (
              <PropertyCard key={property.reference} property={property} />
            ))}
          </div>
        </section>

        <section className="owner-pitch reveal">
          <div>
            <span className="owner-pitch__eyebrow">Propriétaires</span>
            <h2 className="owner-pitch__title">
              Un abonnement,
              <br />
              pas une commission.
            </h2>
            <p className="p">
              Vous gardez la main sur la sélection. Nous vérifions identité, revenus et
              cohérence avant que le dossier arrive chez vous.
            </p>

            {subscription.monthlyAmountCents !== null ? (
              <div className="owner-pitch__price">
                <span className="owner-pitch__amount">
                  {fmt.euros(subscription.monthlyAmountCents)}
                </span>
                <span className="label">/ mois / bien · sans engagement</span>
              </div>
            ) : null}

            <div className="flex gap-12 wrap ai-c mt-24">
              <Link href="/proprietaires" className="btn">
                Publier un bien
              </Link>
              <Link href="/proprietaires" className="link">
                Détail de l’abonnement →
              </Link>
            </div>
          </div>

          <div className="panel panel--strong">
            {OWNER_STEPS.map((step) => (
              <div key={step.n} className="owner-step">
                <span className="owner-step__n">{step.n}</span>
                <div>
                  <div className="h-sm">{step.title}</div>
                  <p className="p-sm mt-6">{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
