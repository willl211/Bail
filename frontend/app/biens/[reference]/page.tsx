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

  const specs = [
    { key: 'SURFACE', value: fmt.surfaceLower(property.surfaceM2) },
    { key: 'PIÈCES', value: String(property.rooms) },
    { key: 'ÉTAGE', value: property.floor ?? '—' },
    { key: 'DPE', value: property.energyRating },
    { key: 'AMEUBLEMENT', value: fmt.furnishedLabel(property.furnished) },
    { key: 'CHARGES', value: fmt.euros(property.chargesCents) },
    {
      key: 'DISPONIBLE',
      value: fmt.availability(property.availableFrom, property.availableImmediately),
    },
    { key: 'BAIL', value: fmt.leaseDuration(property.leaseDurationMonths) },
  ];

  // Les pastilles colorées de la maquette (« VOUS : 3 000 € », « CONFORME »)
  // confrontent le dossier du visiteur aux critères du propriétaire. Sans
  // compte, il n'y a rien à confronter : les pastilles restent, en gris, avec
  // une information factuelle. Elles reprendront leur rôle à l'écran 3.
  const criteria = [
    property.ownerCriteria.minMonthlyIncomeCents !== null
      ? {
          key: 'Revenus minimum',
          value: `${fmt.euros(property.ownerCriteria.minMonthlyIncomeCents)} net`,
          tag: '3× LE LOYER HC',
        }
      : null,
    {
      key: 'Garant',
      value: fmt.guarantorRequirement(property.ownerCriteria.guarantorRequirement),
      tag: property.ownerCriteria.guarantorRequirement === 'REQUIRED' ? 'EXIGÉ' : 'NON REQUIS',
    },
    {
      key: 'Type de contrat',
      value: fmt.contractTypes(property.ownerCriteria.acceptedContractTypes),
      tag: 'CONTRÔLÉ AU DOSSIER',
    },
  ].filter((row): row is { key: string; value: string; tag: string } => row !== null);

  const paragraphs = property.description.split('\n').filter((line) => line.trim() !== '');

  return (
    <main className="listing anim-fade-in">
      <Link href="/recherche" className="btn-quiet btn-quiet-muted listing__back">
        ← RETOUR AUX RÉSULTATS
      </Link>

      <div className="listing__gallery anim-fade-up">
        {property.photos.map((photo, index) => (
          <PhotoPlaceholder key={`${photo.storageKey}-${index}`} label={photo.label} />
        ))}
      </div>

      <div className="listing__columns">
        <div className="listing__main">
          <div className="listing__ref">{property.reference} · MIS EN LIGNE PAR LE PROPRIÉTAIRE</div>
          <h1 className="listing__title">{property.title}</h1>
          <div className="listing__address">
            {property.addressLine} · {property.district.name}, {property.city}
          </div>

          <div className="spec-grid reveal">
            {specs.map((spec) => (
              <div key={spec.key} className="spec-grid__cell">
                <div className="spec-grid__key">{spec.key}</div>
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

          <div className="criteria reveal">
            <div className="criteria__head">CRITÈRES DU PROPRIÉTAIRE</div>
            {criteria.map((row) => (
              <div key={row.key} className="criteria__row">
                <span className="criteria__key">{row.key}</span>
                <span className="criteria__value">
                  <span>{row.value}</span>
                  <span className="criteria__tag" style={{ color: 'var(--ink-3)' }}>
                    {row.tag}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <aside className="listing__aside">
          <div className="card anim-fade-up" style={{ animationDelay: '0.1s' }}>
            <div className="booking__price">
              <div className="booking__amount">
                <span className="booking__amount-value">
                  {fmt.euros(property.totalRentCents)}
                </span>
                <span className="booking__amount-unit">/ MOIS CC</span>
              </div>
              <div className="booking__breakdown">
                DONT {fmt.euros(property.chargesCents)} DE CHARGES · DÉPÔT{' '}
                {fmt.euros(property.depositCents)}
              </div>
            </div>

            <div className="prospect">
              <div className="prospect__head">
                <span className="prospect__mark">→</span>
                <span className="prospect__title">DOSSIER NUMÉRIQUE</span>
              </div>
              <div className="prospect__text">
                Déposez vos justificatifs une seule fois. Ils sont vérifiés, puis transmis avec
                votre candidature — sans pièce à renvoyer à chaque bien.
              </div>
            </div>

            <div className="booking__actions">
              <Link href="/dossier" className="btn btn-block">
                Créer mon dossier pour candidater
              </Link>
              {responseDelay ? (
                <div className="booking__response">RÉPONSE MOYENNE SOUS {responseDelay}</div>
              ) : (
                <div style={{ height: 18 }} />
              )}

              <div className="booking__section-label">PRENDRE RDV DE VISITE</div>
              <div className="booking__slots">
                <Link href="/dossier" className="slot">
                  <span>VISITE ACCOMPAGNÉE</span>
                  <span className="slot__type">SUR PLACE</span>
                </Link>
                <Link href="/dossier" className="slot">
                  <span>VISITE EN VISIO</span>
                  <span className="slot__type">EN DIRECT</span>
                </Link>
              </div>
              <div className="booking__response" style={{ margin: '10px 0 0', textAlign: 'left' }}>
                VÉRIFICATION D&apos;IDENTITÉ REQUISE AVANT TOUT RENDEZ-VOUS
              </div>
            </div>
          </div>

          <div className="booking__note">
            Louer en direct : des honoraires réduits par rapport à une agence, annoncés avant la
            candidature.
          </div>
        </aside>
      </div>
    </main>
  );
}
