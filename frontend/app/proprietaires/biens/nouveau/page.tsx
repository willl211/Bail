import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OwnerAside } from '@/components/owner-aside';
import { PropertyForm } from '@/components/property-form';
import { getCurrentUser, getDistricts, getOwnerSummary } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Déposer une annonce' };

/**
 * Dépôt d'une nouvelle annonce.
 *
 * Aucun brouillon n'est créé à l'ouverture de la page : le bien naît à la
 * première sauvegarde. Créer en base sur un simple affichage laisserait un
 * brouillon vide derrière chaque visite, et un rechargement en créerait un
 * deuxième.
 */
export default async function NewPropertyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');

  const [districts, summary] = await Promise.all([getDistricts(), getOwnerSummary()]);

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
              <h1 className="d3 mt-8">Déposer une annonce</h1>
            </div>
            <span className="label">Enregistrable en brouillon à tout moment</span>
          </div>

          <PropertyForm property={null} districts={districts} />
        </div>
      </div>
    </div>
  );
}
