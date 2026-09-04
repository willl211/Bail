import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PropertyRow } from '@/components/property-row';
import { SearchFilters } from '@/components/search-filters';
import { SortSelect } from '@/components/sort-select';
import { getCurrentUser, getDistricts, getSavedReferences, searchProperties } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Biens à louer à Metz',
  description:
    'Studios, deux et trois pièces meublés ou nus à Metz, centre-ville et quartiers proches. Location en direct, sans frais d’agence.',
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Ne laisse passer vers l'API que les paramètres qu'elle accepte. */
function toApiParams(searchParams: SearchParams): URLSearchParams {
  const allowed = [
    'maxRent',
    'minRent',
    'minSurface',
    'minRooms',
    'maxRooms',
    'furnished',
    'districts',
    'sort',
    'page',
  ];

  const params = new URLSearchParams();
  for (const key of allowed) {
    const value = searchParams[key];
    if (typeof value === 'string' && value !== '') params.set(key, value);
  }
  // Aucun `maxRent` par défaut : sans critère, on montre tout le portefeuille.
  params.set('pageSize', '60');
  return params;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const params = toApiParams(resolved);
  const [results, districts, user, savedReferences] = await Promise.all([
    searchProperties(params),
    getDistricts(),
    getCurrentUser(),
    getSavedReferences(),
  ]);

  const maxRent = params.get('maxRent');

  // Le tri par compatibilité n'est offert qu'au locataire, et l'API dit s'il a
  // pu l'appliquer : sans revenus au dossier, elle sert la récence. On le lui
  // signale plutôt que de laisser un classement muet passer pour un classement
  // par compatibilité.
  const isTenant = user?.role === 'TENANT';
  const askedCompatibility = (resolved.sort ?? 'compatibility') === 'compatibility';
  const compatibilityFellBack = isTenant && askedCompatibility && results.sort !== 'compatibility';

  return (
    <main className="results anim-fade-in">
      <Suspense fallback={<aside className="filters" />}>
        <SearchFilters districts={districts} />
      </Suspense>

      <section>
        <div className="results__head">
          <div>
            <h1 className="section__title">Biens à louer · Metz</h1>
            <span className="results__count">
              {results.total} {results.total > 1 ? 'résultats' : 'résultat'}
              {maxRent ? ` · loyer max ${Number(maxRent).toLocaleString('fr-FR')} €` : null}
            </span>
          </div>

          <div className="results__sort">
            <span className="label">Tri</span>
            <Suspense fallback={null}>
              <SortSelect compatibility={isTenant} />
            </Suspense>
          </div>
        </div>

        {compatibilityFellBack ? (
          <p className="reminder">
            Classement par date de publication. Renseignez vos revenus dans votre
            dossier pour voir d’abord les biens à votre portée.{' '}
            <Link href="/dossier">Compléter mon dossier</Link>
          </p>
        ) : null}

        {results.items.length === 0 ? (
          <div className="results__empty">
            Aucun bien ne correspond à ces critères. Élargissez le loyer ou ajoutez un
            quartier.
          </div>
        ) : (
          results.items.map((property) => (
            <PropertyRow
              key={property.reference}
              property={property}
              saved={savedReferences.includes(property.reference)}
              role={user?.role ?? null}
            />
          ))
        )}
      </section>
    </main>
  );
}
