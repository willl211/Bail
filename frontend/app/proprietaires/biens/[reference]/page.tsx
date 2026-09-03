import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { OwnerAside } from '@/components/owner-aside';
import { PropertyForm } from '@/components/property-form';
import {
  ApiError,
  getCurrentUser,
  getDistricts,
  getOwnerProperty,
  getOwnerSummary,
  type PropertyStatus,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ reference: string }> };

const STATUS_LABEL: Record<PropertyStatus, string> = {
  DRAFT: 'Brouillon',
  PENDING_REVIEW: 'Contrôle en cours',
  ONLINE: 'En ligne',
  VISITS_IN_PROGRESS: 'En visite',
  RENTED: 'Loué',
  ARCHIVED: 'Archivé',
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Bien ${reference}` };
}

export default async function EditPropertyPage({ params }: Params) {
  const { reference } = await params;

  const user = await getCurrentUser();
  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');

  const [districts, summary] = await Promise.all([getDistricts(), getOwnerSummary()]);

  let property;
  try {
    property = await getOwnerProperty(reference);
  } catch (error) {
    // L'API renvoie 404 aussi bien pour un bien inexistant que pour celui d'un
    // autre propriétaire — répondre « interdit » confirmerait son existence.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="app">
        <OwnerAside user={user} summary={summary} current="properties" />

        <div className="body">
          <div className="page__head">
            <div>
              <Link href="/proprietaires/biens" className="link">
                ← Mes biens
              </Link>
              <div className="flex gap-12 wrap ai-c mt-8">
                <h1 className="d3">{property.title}</h1>
                <span
                  className={
                    property.status === 'DRAFT'
                      ? 'badge badge--pending'
                      : property.status === 'ONLINE' || property.status === 'VISITS_IN_PROGRESS'
                        ? 'badge badge--ok'
                        : 'badge badge--mute'
                  }
                >
                  {STATUS_LABEL[property.status]}
                </span>
              </div>
              <span className="label mt-6">
                {property.reference} · {property.district}
              </span>
            </div>

            <div className="stats">
              <div>
                <span className="label">Photos</span>
                <div className="stat__value">{property.photoCount}</div>
              </div>
              <div>
                <span className="label">Candidatures</span>
                <div className="stat__value">{property.applicationCount}</div>
              </div>
            </div>
          </div>

          <PropertyForm property={property} districts={districts} />
        </div>
      </div>
    </div>
  );
}
