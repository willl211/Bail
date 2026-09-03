import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OwnerAside } from '@/components/owner-aside';
import { getCurrentUser, getOwnerProperties, getOwnerSummary } from '@/lib/api';
import { VerifyEmailNotice } from '@/components/verify-email-notice';
import type { OwnerProperty, PropertyStatus } from '@/lib/api';
import * as fmt from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Mes biens' };

/** Libellés et tonalité des statuts, tels qu'affichés dans la maquette. */
const STATUS: Record<PropertyStatus, { label: string; tone: 'ok' | 'pending' | 'mute' }> = {
  DRAFT: { label: 'Brouillon', tone: 'pending' },
  PENDING_REVIEW: { label: 'Contrôle en cours', tone: 'pending' },
  ONLINE: { label: 'En ligne', tone: 'ok' },
  VISITS_IN_PROGRESS: { label: 'En visite', tone: 'ok' },
  RENTED: { label: 'Loué', tone: 'mute' },
  ARCHIVED: { label: 'Archivé', tone: 'mute' },
};

function Holding({ property }: { property: OwnerProperty }) {
  const status = STATUS[property.status];

  return (
    <Link href={`/proprietaires/biens/${property.reference}`} className="holding">
      <div>
        <div className="holding__title">{property.title}</div>
        <div className="holding__meta">
          {property.reference} · {property.district} · {property.addressLine || 'adresse à saisir'}
        </div>

        <div className="holding__checks">
          <span className={`badge badge--${status.tone}`}>{status.label}</span>
          {property.blockers.map((blocker) => (
            <span key={blocker} className="badge badge--reject badge--nodot">
              {blocker}
            </span>
          ))}
          {property.warnings.map((warning) => (
            <span key={warning} className="badge badge--pending badge--nodot">
              {warning}
            </span>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Candidatures</span>
        <div className="stat__value">{property.applicationCount}</div>
      </div>

      <div>
        <div className="holding__rent">
          {property.totalRentCents > 0 ? fmt.euros(property.totalRentCents) : '—'}
        </div>
        <div className="holding__meta" style={{ textAlign: 'right' }}>
          {property.surfaceM2 > 0 ? fmt.surfaceLower(property.surfaceM2) : 'surface à saisir'}
        </div>
      </div>
    </Link>
  );
}

export default async function OwnerPropertiesPage() {
  const user = await getCurrentUser();
  // Le contrôle qui compte est côté API (guard de rôle) ; cette redirection
  // évite seulement d'afficher un écran vide à qui n'est pas propriétaire.
  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');

  const [properties, summary] = await Promise.all([
    getOwnerProperties(),
    getOwnerSummary(),
  ]);

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      {user.emailVerified ? null : <VerifyEmailNotice email={user.email} />}

      <div className="app">
        <OwnerAside user={user} summary={summary} current="properties" />

        <div className="body">
          <div className="page__head">
            <div>
              <span className="label label--accent">Espace propriétaire</span>
              <h1 className="d3 mt-8">Mes biens</h1>
            </div>

            <div className="stats">
              <div>
                <span className="label">Diffusés</span>
                <div className="stat__value">{summary.onlineCount}</div>
              </div>
              <div>
                <span className="label">Brouillons</span>
                <div className="stat__value">{summary.draftCount}</div>
              </div>
              <div>
                <span className="label">Au contrôle</span>
                <div className="stat__value">{summary.pendingReviewCount}</div>
              </div>
              <div>
                <span className="label">Candidatures</span>
                <div className="stat__value">{summary.applicationCount}</div>
              </div>
              <div>
                <span className="label">Ce mois</span>
                <div className="stat__value">
                  {summary.monthlyCostCents === null
                    ? '—'
                    : fmt.euros(summary.monthlyCostCents)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-12 wrap ai-c mt-20">
            <Link href="/proprietaires/biens/nouveau" className="btn">
              Déposer une annonce
            </Link>
            <span className="label">
              Mise en ligne après contrôle · sous 2 h en moyenne
            </span>
          </div>

          {properties.length === 0 ? (
            <div className="panel mt-24" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <p className="p" style={{ margin: '0 auto' }}>
                Aucun bien pour l’instant. Déposez votre première annonce — vous pouvez
                l’enregistrer en brouillon et la compléter plus tard.
              </p>
            </div>
          ) : (
            <div className="panel panel--strong mt-24">
              {properties.map((property) => (
                <Holding key={property.reference} property={property} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
