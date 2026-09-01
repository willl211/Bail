import Link from 'next/link';
import { AnimatedCounter } from '@/components/animated-counter';
import { HeroSearch } from '@/components/hero-search';
import { PropertyCard } from '@/components/property-card';
import {
  getDistricts,
  getFeaturedProperties,
  getMarketSnapshot,
  getOwnerSubscriptionPricing,
} from '@/lib/api';
import * as fmt from '@/lib/format';

export const dynamic = 'force-dynamic';

const OWNER_STEPS = [
  {
    n: '01',
    title: 'Décrivez le bien',
    text: 'Diagnostics, photos et critères de sélection. Publication sous 2 h après contrôle.',
  },
  {
    n: '02',
    title: 'Recevez des dossiers vérifiés',
    text: 'Identité, revenus et cohérence contrôlés automatiquement avant transmission.',
  },
  {
    n: '03',
    title: 'Signez le bail en ligne',
    text: 'Bail conforme, état des lieux photo, quittances mensuelles automatiques.',
  },
];

export default async function HomePage() {
  const [featured, districts, market, subscription] = await Promise.all([
    getFeaturedProperties(3),
    getDistricts(),
    getMarketSnapshot(),
    getOwnerSubscriptionPricing(),
  ]);

  return (
    <main className="page">
      <div className="hero">
        <div className="hero__main anim-fade-up">
          <div className="hero__eyebrow">PREMIER MARCHÉ — METZ MÉTROPOLE</div>
          <h1 className="hero__title">
            Louer sans agence.
            <br />
            Candidater sans dossier papier.
          </h1>
          <p className="hero__lead">
            Les propriétaires publient leur bien avec un abonnement mensuel, sans commission. Les
            locataires déposent un dossier vérifié une seule fois, puis candidatent en un clic.
          </p>

          <HeroSearch districts={districts} />

          <div className="hero__reassurance">
            <span>Dossier vérifié en 24 h</span>
            <span>Honoraires réduits, annoncés d&apos;avance</span>
            <span>Bail et état des lieux en ligne</span>
          </div>
        </div>

        <div className="hero__aside anim-fade-up" style={{ animationDelay: '0.12s' }}>
          <div className="card">
            <div className="registry__head">
              <div className="label" style={{ marginBottom: 10 }}>
                BIENS VÉRIFIÉS · MOSELLE
              </div>
              <div className="registry__counter">
                <AnimatedCounter target={market.verifiedPropertyCount} />
              </div>
              <div className="bar" style={{ height: 2, marginTop: 14 }}>
                <div className="bar-fill" style={{ height: 2 }} />
              </div>
            </div>

            {market.metrics.map((metric) => (
              <div key={metric.key} className="registry__row">
                <span className="registry__key">{metric.label}</span>
                <span className="registry__value">{metric.value}</span>
              </div>
            ))}

            <div className="registry__foot">
              <span className="registry__dot" />
              <span className="registry__status">VÉRIFICATION AUTOMATISÉE ACTIVE</span>
            </div>
          </div>
        </div>
      </div>

      <section className="section reveal">
        <div className="section__head">
          <h2 className="section__title">Biens en avant à Metz</h2>
          <Link href="/recherche" className="btn-quiet">
            VOIR LES {market.verifiedPropertyCount} BIENS →
          </Link>
        </div>
        <div className="card-grid">
          {featured.map((property) => (
            <PropertyCard key={property.reference} property={property} />
          ))}
        </div>
      </section>

      <section className="owner-pitch reveal">
        <div className="owner-pitch__text">
          <div className="owner-pitch__eyebrow">PROPRIÉTAIRES</div>
          <h2 className="owner-pitch__title">Un abonnement, pas une commission.</h2>
          <p className="owner-pitch__lead">
            Vous gardez la main sur la sélection. Nous vérifions l&apos;identité, les revenus et la
            cohérence des dossiers avant qu&apos;ils arrivent chez vous.
          </p>
          {subscription.monthlyAmountCents !== null ? (
            <div className="owner-pitch__price">
              <span className="owner-pitch__amount">
                {fmt.euros(subscription.monthlyAmountCents)}
              </span>
              <span className="owner-pitch__unit">/ MOIS / BIEN · SANS ENGAGEMENT</span>
            </div>
          ) : null}
        </div>

        <div className="owner-pitch__steps">
          {OWNER_STEPS.map((step) => (
            <div key={step.n} className="owner-step">
              <span className="owner-step__n">{step.n}</span>
              <div>
                <div className="owner-step__title">{step.title}</div>
                <div className="owner-step__text">{step.text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
