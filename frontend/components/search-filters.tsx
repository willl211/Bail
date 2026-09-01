'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { District } from '@/lib/api';

const SURFACE_OPTIONS = [
  { label: 'TOUTES', value: 0 },
  { label: '30 M²+', value: 30 },
  { label: '50 M²+', value: 50 },
  { label: '80 M²+', value: 80 },
];

const FURNISHED_OPTIONS = [
  { label: 'TOUS', value: 'all' },
  { label: 'MEUBLÉ', value: 'furnished' },
  { label: 'NU', value: 'unfurnished' },
];

export const RENT_MIN = 400;
export const RENT_MAX = 1600;
export const RENT_DEFAULT = 1200;

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
  const selectedDistricts = (searchParams.get('districts') ?? '')
    .split(',')
    .filter(Boolean);

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
      <div className="card">
        <div className="filters__head">FILTRES</div>

        <div className="filters__block filters__block--first">
          <div className="filters__range-head">
            <span className="filters__legend" style={{ marginBottom: 0 }}>
              Loyer maximum
            </span>
            <span className="filters__range-value">{euros(maxRent)}</span>
          </div>
          <input
            type="range"
            min={RENT_MIN}
            max={RENT_MAX}
            step={50}
            value={maxRent}
            aria-label="Loyer maximum charges comprises"
            onChange={(event) => onRentInput(Number(event.target.value))}
            style={{ width: '100%' }}
          />
          <div className="filters__range-bounds">
            <span>{RENT_MIN}</span>
            <span>{RENT_MAX.toLocaleString('fr-FR')}</span>
          </div>
        </div>

        <div className="filters__block">
          <div className="filters__legend">Surface minimum</div>
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
          <div className="filters__legend">Quartier</div>
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
          <div className="filters__legend">Ameublement</div>
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

        <button type="button" className="filters__reset" onClick={onReset}>
          RÉINITIALISER
        </button>
      </div>
    </aside>
  );
}
