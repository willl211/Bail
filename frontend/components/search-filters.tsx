'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { District } from '@/lib/api';

export const SURFACE_MIN = 0;
export const SURFACE_MAX = 120;
/**
 * Zéro par défaut, donc aucun bien masqué.
 *
 * Même raison que pour le loyer : arriver sur la recherche sans critère doit
 * montrer tout le portefeuille, et un filtre actif d'emblée cacherait des
 * annonces sans que le visiteur l'ait demandé.
 *
 * Le curseur remplace les paliers figés de la maquette (25 / 45 / 65 m²), à la
 * demande du porteur de projet : ces seuils obligeaient à s'accommoder de
 * valeurs arbitraires, alors qu'on cherche rarement « 45 m² » et souvent
 * « au moins 40 ».
 */
export const SURFACE_DEFAULT = SURFACE_MIN;

const FURNISHED_OPTIONS = [
  { label: 'Tous', value: 'all' },
  { label: 'Meublé', value: 'furnished' },
  { label: 'Nu', value: 'unfurnished' },
];

export const RENT_MIN = 400;
export const RENT_MAX = 1400;
/**
 * Par défaut le curseur est au maximum, donc aucun bien n'est masqué : arriver
 * sur la recherche sans critère doit montrer tout le portefeuille. La maquette
 * affichait 900 €, mais c'était un état de démonstration, pas une règle — un
 * filtre actif par défaut cacherait des annonces sans que le visiteur l'ait
 * demandé.
 */
export const RENT_DEFAULT = RENT_MAX;

const euros = (value: number) => `${value.toLocaleString('fr-FR')} €`;

/** « Toutes » vaut mieux que « 0 m² et plus », qui ne filtre rien non plus. */
const surfaceLabel = (value: number) =>
  value === SURFACE_DEFAULT ? 'Toutes' : `${value} m² et plus`;

/**
 * Panneau de filtres.
 *
 * L'état vit dans l'URL : la recherche est partageable, indexable et
 * rechargeable, et les résultats restent rendus côté serveur. Le curseur de
 * loyer bouge immédiatement à l'écran et n'écrit dans l'URL qu'après 250 ms,
 * pour ne pas relancer une requête à chaque pixel.
 */
export function SearchFilters({ districts }: { districts: District[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const urlMaxRent = Number(searchParams.get('maxRent') ?? RENT_DEFAULT);
  const urlMinSurface = Number(searchParams.get('minSurface') ?? SURFACE_DEFAULT);
  const furnished = searchParams.get('furnished') ?? 'all';
  const selectedDistricts = (searchParams.get('districts') ?? '').split(',').filter(Boolean);

  const [maxRent, setMaxRent] = useState(urlMaxRent);
  const [syncedRent, setSyncedRent] = useState(urlMaxRent);
  const [minSurface, setMinSurface] = useState(urlMinSurface);
  const [syncedSurface, setSyncedSurface] = useState(urlMinSurface);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const surfaceDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Resynchronise le curseur quand l'URL change par ailleurs (réinitialisation,
  // navigation arrière). Ajustement pendant le rendu plutôt que dans un effet :
  // pas de rendu intermédiaire avec l'ancienne valeur.
  if (urlMaxRent !== syncedRent) {
    setSyncedRent(urlMaxRent);
    setMaxRent(urlMaxRent);
  }
  if (urlMinSurface !== syncedSurface) {
    setSyncedSurface(urlMinSurface);
    setMinSurface(urlMinSurface);
  }

  useEffect(
    () => () => {
      clearTimeout(debounce.current);
      clearTimeout(surfaceDebounce.current);
    },
    [],
  );

  const pushParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const onRentInput = (value: number) => {
    setMaxRent(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      pushParams((params) => {
        if (value === RENT_DEFAULT) params.delete('maxRent');
        else params.set('maxRent', String(value));
      });
    }, 250);
  };

  // Même traitement que le loyer : le curseur bouge tout de suite à l'écran et
  // n'écrit dans l'URL qu'après 250 ms, pour ne pas relancer une requête à
  // chaque pixel parcouru.
  const onSurfaceInput = (value: number) => {
    setMinSurface(value);
    clearTimeout(surfaceDebounce.current);
    surfaceDebounce.current = setTimeout(() => {
      pushParams((params) => {
        if (value === SURFACE_DEFAULT) params.delete('minSurface');
        else params.set('minSurface', String(value));
      });
    }, 250);
  };

  const onFurnished = (value: string) =>
    pushParams((params) => {
      if (value === 'all') params.delete('furnished');
      else params.set('furnished', value);
    });

  const onToggleDistrict = (slug: string) =>
    pushParams((params) => {
      const next = selectedDistricts.includes(slug)
        ? selectedDistricts.filter((entry) => entry !== slug)
        : [...selectedDistricts, slug];
      if (next.length === 0) params.delete('districts');
      else params.set('districts', next.join(','));
    });

  const onReset = () => {
    setMaxRent(RENT_DEFAULT);
    setMinSurface(SURFACE_DEFAULT);
    startTransition(() => router.replace(pathname, { scroll: false }));
  };

  return (
    <aside className="filters">
      <div className="panel panel--strong">
        <div className="filters__head">
          <span className="label label--ink">Filtres</span>
          <button type="button" className="link" onClick={onReset}>
            Réinitialiser
          </button>
        </div>

        <div className="filters__block filters__block--first">
          <div className="filters__legend">
            <span>Loyer maximum</span>
            <span className="filters__range-value">{euros(maxRent)}</span>
          </div>
          <input
            type="range"
            min={RENT_MIN}
            max={RENT_MAX}
            step={25}
            value={maxRent}
            aria-label="Loyer maximum charges comprises"
            onChange={(event) => onRentInput(Number(event.target.value))}
          />
          <div className="filters__range-bounds">
            <span>{RENT_MIN}</span>
            <span>{RENT_MAX.toLocaleString('fr-FR')}</span>
          </div>
          <p className="p-sm mt-6">Charges comprises, hors honoraires.</p>
        </div>

        <div className="filters__block">
          <div className="filters__legend">
            <span>Surface minimum</span>
            <span className="filters__range-value">{surfaceLabel(minSurface)}</span>
          </div>
          <input
            type="range"
            min={SURFACE_MIN}
            max={SURFACE_MAX}
            step={5}
            value={minSurface}
            aria-label="Surface habitable minimum"
            aria-valuetext={surfaceLabel(minSurface)}
            onChange={(event) => onSurfaceInput(Number(event.target.value))}
          />
          <div className="filters__range-bounds">
            <span>Toutes</span>
            <span>{SURFACE_MAX} m²</span>
          </div>
        </div>

        <div className="filters__block">
          <div className="filters__legend">
            <span>Quartier</span>
          </div>
          <div className="filters__checks">
            {districts.map((district) => {
              const checked = selectedDistricts.includes(district.slug);
              return (
                <button
                  key={district.slug}
                  type="button"
                  className="check"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => onToggleDistrict(district.slug)}
                >
                  <span className="check__label">
                    <span className="check__box" data-checked={checked} />
                    {district.name}
                  </span>
                  <span className="check__count">{district.availableCount}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="filters__block">
          <div className="filters__legend">
            <span>Ameublement</span>
          </div>
          <div className="filters__segmented">
            {FURNISHED_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="chip"
                data-active={furnished === option.value}
                aria-pressed={furnished === option.value}
                onClick={() => onFurnished(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filters__block filters__block--wash">
          <span className="label label--accent">Dossier vérifié</span>
          <p className="p-sm mt-8">
            Avec un dossier vérifié, les biens compatibles avec vos revenus remontent en
            tête et vous candidatez sans rien ressaisir.
          </p>
          <Link href="/dossier" className="btn btn-sm btn-block mt-12">
            Créer mon dossier
          </Link>
        </div>
      </div>
    </aside>
  );
}
