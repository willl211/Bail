import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PhotoPlaceholder } from '@/components/photo-placeholder';
import { ApiError, getMarketSnapshot, getProperty } from '@/lib/api';
import * as fmt from '@/lib/format';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ reference: string }> };

async function loadProperty(reference: string) {
  try {
    return await getProperty(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reference } = await params;
  try {
    const property = await getProperty(reference);
    return {
      title: `${property.title} — ${fmt.euros(property.totalRentCents)} CC`,
      description: property.description.slice(0, 180),
    };
  } catch {
    return { title: 'Annonce introuvable' };
  }
}

export default async function PropertyPage({ params }: Params) {
  const { reference } = await params;
  const property = await loadProperty(reference);
  const market = await getMarketSnapshot().catch(() => null);

  const responseDelay =
    market?.metrics.find((metric) => metric.key === 'averageResponseDelay')?.value ?? null;

  const visiting = property.status === 'VISITS_IN_PROGRESS';
  const fees = property.tenantFees;

  const specs = [
    { key: 'Surface', value: fmt.surfaceLower(property.surfaceM2) },
    { key: 'Pièces', value: String(property.rooms) },
    { key: 'Étage', value: property.floor ?? '—' },
    { key: 'DPE', value: fmt.energyRating(property.energyRating) },
    { key: 'Ameublement', value: fmt.furnishedLabel(property.furnished) },
    { key: 'Charges', value: fmt.euros(property.chargesCents) },
    {
      key: 'Disponibilité',
      value: fmt.availability(property.availableFrom, property.availableImmediately),
    },
    { key: 'Dépôt', value: fmt.euros(property.depositCents) },
  ];

  // Les pastilles de la maquette confrontent le dossier du visiteur aux critères
  // du propriétaire. Sans compte, il n'y a rien à confronter : elles portent une
  // information factuelle et reprendront leur rôle à l'écran 3.
  const criteria = [
    property.ownerCriteria.minMonthlyIncomeCents !== null
      ? {
          key: 'Revenus nets mensuels minimum',
          value: fmt.euros(property.ownerCriteria.minMonthlyIncomeCents),
          tag: '3 × le loyer',
        }
      : null,
    {
      key: 'Garant',
      value: fmt.guarantorRequirement(property.ownerCriteria.guarantorRequirement),
      tag: 'Physique ou moral',
    },
    {
      key: 'Types de contrat acceptés',
      value: fmt.contractTypes(property.ownerCriteria.acceptedContractTypes),
      tag: null,
    },
    {
      key: 'Durée de bail',
      value: `${fmt.leaseDuration(property.leaseDurationMonths)} — bail ${fmt.furnishedLabel(property.furnished).toLowerCase()}`,
      tag: null,
    },
  ].filter((row): row is { key: string; value: string; tag: string | null } => row !== null);

  const paragraphs = property.description.split('\n').filter((line) => line.trim() !== '');

  return (
    <main className="listing anim-fade-in">
      <Link href="/recherche" className="link listing__back">
        ← Retour aux résultats
      </Link>

      <div className="listing__gallery anim-rise">
        {property.photos.map((photo, index) => (
          <PhotoPlaceholder
            key={`${photo.storageKey}-${index}`}
            label={`${String(index + 1).padStart(2, '0')} · ${photo.label}`}
            scale={index === 0}
          />
        ))}
      </div>

      <div className="listing__columns">
        <div>
          <div className="listing__id">
            <span className="label">{property.reference}</span>
            <span className={visiting ? 'badge badge--pending' : 'badge badge--ok'}>
              {visiting ? 'En visite' : 'En ligne'}
            </span>
            <span className="label">Publié par le propriétaire</span>
          </div>

          <h1 className="listing__title">{property.title}</h1>
          <p className="listing__address">
            {property.addressLine} · {property.district.name}, {property.city}
          </p>

          <div className="spec-grid reveal">
            {specs.map((spec) => (
              <div key={spec.key} className="spec-grid__cell">
                <span className="label">{spec.key}</span>
                <div className="spec-grid__value">{spec.value}</div>
              </div>
            ))}
          </div>

          <h2 className="listing__subtitle reveal">Le bien</h2>
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="listing__paragraph">
              {paragraph}
            </p>
          ))}

          <h2 className="listing__subtitle reveal">Critères du propriétaire</h2>
          <div className="criteria reveal">
            {criteria.map((row) => (
              <div key={row.key} className="criteria__row">
                <span className="criteria__key">{row.key}</span>
                <span className="criteria__value">
                  <span>{row.value}</span>
                  {row.tag ? (
                    <span className="badge badge--mute badge--nodot">{row.tag}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <p className="p-sm mt-12">
            Le propriétaire fixe ces critères. Il reçoit une synthèse vérifiée, jamais vos
            documents.
          </p>
        </div>

        <aside className="listing__aside">
          <div className="panel panel--strong tick anim-rise anim-rise-1">
            <div className="booking__price">
              <div className="booking__amount">
                <span className="booking__amount-value">
                  {fmt.euros(property.totalRentCents)}
                </span>
                <span className="label">/ mois CC</span>
              </div>
              <span className="label mt-6">
                Dont {fmt.euros(property.chargesCents)} de charges · dépôt{' '}
                {fmt.euros(property.depositCents)}
              </span>
            </div>

            {/* Les honoraires sont annoncés ici, avant toute candidature. */}
            {fees ? (
              <div className="booking__fees">
                <span className="label label--accent">Honoraires locataire</span>
                <div className="flex ai-c gap-10 mt-8">
                  <span className="booking__fees-amount">{fmt.euros(fees.totalCents)}</span>
                  <span className="p-sm">
                    TTC · {fmt.surfaceLower(property.surfaceM2)} ×{' '}
                    {(fees.centsPerSqm / 100).toLocaleString('fr-FR')} €/m²
                  </span>
                </div>
                <p className="p-sm mt-8">
                  Une seule fois, à la signature. Dont{' '}
                  {fmt.euros(fees.inventoryCents)} d’état des lieux.
                </p>
                {!fees.isLegallyApproved ? (
                  <p className="p-sm mt-8">
                    <span className="badge badge--pending badge--nodot">Barème provisoire</span>{' '}
                    Montant du pilote, en attente de validation juridique.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="booking__body">
              <Link href="/dossier" className="btn btn-block">
                Créer mon dossier pour candidater
              </Link>
              {responseDelay ? (
                <p className="booking__response">Réponse moyenne sous {responseDelay}</p>
              ) : null}

              <hr className="rule mt-20 mb-12" />

              <span className="label label--ink">Prendre rendez-vous de visite</span>
              <div className="mt-10">
                <Link href="/dossier" className="slot">
                  <span>Visite accompagnée</span>
                  <span className="slot__type">Sur place</span>
                </Link>
                <Link href="/dossier" className="slot">
                  <span>Visite en visio</span>
                  <span className="slot__type">En direct</span>
                </Link>
              </div>
              <p className="p-sm mt-10">
                Vérification d’identité requise avant le rendez-vous.
              </p>
            </div>
          </div>

          <div className="panel" style={{ borderTop: 0 }}>
            <div style={{ padding: '14px 17px' }}>
              <span className="label">Diagnostic de performance</span>
              <div className="flex ai-c gap-10 mt-8 wrap">
                <span className="badge badge--ok badge--nodot">
                  DPE {fmt.energyRating(property.energyRating)}
                </span>
                {property.gesRating ? (
                  <span className="badge badge--mute badge--nodot">
                    GES {property.gesRating}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
