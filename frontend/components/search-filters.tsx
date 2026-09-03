'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { District } from '@/lib/api';

// Paliers de la maquette : toutes, puis les trois seuils qui séparent
// réellement le portefeuille de Metz (studio, deux pièces, trois pièces).
const SURFACE_OPTIONS = [
  { label: 'Toutes', value: 0 },
  { label: '25 m²+', value: 25 },
  { label: '45 m²+', value: 45 },
  { label: '65 m²+', value: 65 },
];

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
  const minSurface = Number(searchParams.get('minSurface') ?? 0);
  const furnished = searchParams.get('furnished') ?? 'all';
  const selectedDistricts = (searchParams.get('districts') ?? '').split(',').filter(Boolean);

  const [maxRent, setMaxRent] = useState(urlMaxRent);
  const [syncedRent, setSyncedRent] = useState(urlMaxRent);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Resynchronise le curseur quand l'URL change par ailleurs (réinitialisation,
  // navigation arrière). Ajustement pendant le rendu plutôt que dans un effet :
  // pas de rendu intermédiaire avec l'ancienne valeur.
  if (urlMaxRent !== syncedRent) {
    setSyncedRent(urlMaxRent);
    setMaxRent(urlMaxRent);
  }

  useEffect(() => () => clearTimeout(debounce.current), []);

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

  const onSurface = (value: number) =>
    pushParams((params) => {
      if (value === 0) params.delete('minSurface');
      else params.set('minSurface', String(value));
    });

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
          </div>
          <div className="filters__chips">
            {SURFACE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="chip"
                data-active={minSurface === option.value}
                aria-pressed={minSurface === option.value}
                onClick={() => onSurface(option.value)}
              >
                {option.label}
              </button>
            ))}
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
