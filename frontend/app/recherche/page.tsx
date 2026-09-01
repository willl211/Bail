import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PropertyRow } from '@/components/property-row';
import { SearchFilters } from '@/components/search-filters';
import { getDistricts, searchProperties } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Biens à louer à Metz',
  description:
    'Studios, deux et trois pièces meublés ou nus à Metz, centre-ville et quartiers proches. Location en direct, sans frais d’agence.',
};

const SORT_LABELS: Record<string, string> = {
  compatibility: 'PLUS RÉCENTES',
  recent: 'PLUS RÉCENTES',
  rent_asc: 'LOYER CROISSANT',
  rent_desc: 'LOYER DÉCROISSANT',
  surface_desc: 'SURFACE',
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
  if (!params.has('maxRent')) params.set('maxRent', '1200');
  params.set('pageSize', '60');
  return params;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = toApiParams(await searchParams);
  const [results, districts] = await Promise.all([searchProperties(params), getDistricts()]);

  const sortKey = params.get('sort') ?? 'compatibility';
  const sortLabel = SORT_LABELS[sortKey] ?? SORT_LABELS.compatibility;

  return (
    <main className="results anim-fade-in">
      <Suspense fallback={<aside className="filters" />}>
        <SearchFilters districts={districts} />
      </Suspense>

      <section className="results__list">
        <div className="results__head">
          <h1 className="results__title">Biens à louer · Metz</h1>
          <span className="results__count">
            {results.total} {results.total > 1 ? 'RÉSULTATS' : 'RÉSULTAT'} · TRI : {sortLabel}
          </span>
        </div>

        {results.items.length === 0 ? (
          <div className="results__empty">
            Aucun bien ne correspond à ces critères. Élargissez le loyer ou les quartiers.
          </div>
        ) : (
          results.items.map((property) => (
            <PropertyRow key={property.reference} property={property} />
          ))
        )}
      </section>
    </main>
  );
}
