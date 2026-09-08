'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import type { District } from '@/lib/api';

export const SURFACE_MIN = 0;
export const SURFACE_MAX = 120;
export const SURFACE_DEFAULT = SURFACE_MIN;
export const RENT_MIN = 400;
export const RENT_MAX = 1400;
export const RENT_DEFAULT = RENT_MAX;

const euros = (value: number) => `${value.toLocaleString('fr-FR')} €`;
const surfaceLabel = (value: number) => value === 0 ? 'Toutes' : `${value} m² et plus`;
const progress = (value: number, min: number, max: number): CSSProperties =>
  ({ '--range-progress': `${Math.max(0, Math.min(100, (value - min) / (max - min) * 100))}%` }) as CSSProperties;

/** Un seul brouillon et une seule temporisation pour combiner les critères. */
export function SearchFilters({ districts }: { districts: District[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const url = useSearchParams().toString();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState({ source: url, draft: url, sent: [] as string[], external: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestDraft = useRef(url);

  // Une réponse à une navigation précédente ne doit pas écraser un choix plus
  // récent. Un lien externe ou le retour arrière, en revanche, restaure l'URL.
  if (snapshot.source !== url) {
    const ownNavigation = snapshot.sent.includes(url);
    setSnapshot({
      source: url,
      draft: ownNavigation ? snapshot.draft : url,
      sent: ownNavigation ? snapshot.sent.slice(snapshot.sent.lastIndexOf(url) + 1) : [],
      external: snapshot.external + (ownNavigation ? 0 : 1),
    });
  }
  useEffect(() => {
    latestDraft.current = snapshot.draft;
  }, [snapshot.draft]);
  useEffect(() => {
    clearTimeout(timer.current);
    return () => clearTimeout(timer.current);
  }, [snapshot.external]);

  const navigate = (query: string) => {
    setSnapshot((current) => ({ ...current, sent: [...current.sent, query] }));
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };
  const update = (mutate: (params: URLSearchParams) => void, delayed = false) => {
    clearTimeout(timer.current);
    const params = new URLSearchParams(latestDraft.current);
    mutate(params);
    params.delete('page');
    const query = params.toString();
    latestDraft.current = query;
    setSnapshot((current) => ({ ...current, draft: query }));
    if (delayed) timer.current = setTimeout(() => navigate(query), 250);
    else navigate(query);
  };
  const select = (key: string, value: string) => update((params) => {
    if (value) params.set(key, value);
    else params.delete(key);
  });
  const reset = () => {
    clearTimeout(timer.current);
    const sort = new URLSearchParams(latestDraft.current).get('sort');
    const query = sort ? new URLSearchParams({ sort }).toString() : '';
    latestDraft.current = query;
    setSnapshot((current) => ({ ...current, draft: query }));
    navigate(query);
  };

  const showResults = () => {
    setExpanded(false);
    requestAnimationFrame(() => {
      const title = document.getElementById('search-results-title');
      title?.focus({ preventScroll: true });
      title?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
  };

  const params = new URLSearchParams(snapshot.draft);
  const rent = params.has('maxRent') ? Number(params.get('maxRent')) : null;
  const maxRent = rent ?? RENT_DEFAULT;
  const minSurface = Number(params.get('minSurface') ?? SURFACE_DEFAULT);
  const includeCharges = params.get('includeCharges') !== 'false';
  const propertyType = params.get('propertyType') ?? '';
  const furnished = params.get('furnished') ?? 'all';
  const selectedDistricts = (params.get('districts') ?? '').split(',').filter(Boolean);
  const minRooms = params.get('minRooms');
  const maxRooms = params.get('maxRooms');
  const rooms = !minRooms && !maxRooms ? '' : minRooms === maxRooms ? minRooms : minRooms === '4' && !maxRooms ? '4+' : null;
  const activeCount = Number(rent !== null || params.has('minRent')) + Number(minSurface > 0)
    + Number(Boolean(propertyType)) + Number(Boolean(minRooms || maxRooms))
    + Number(furnished !== 'all') + Number(selectedDistricts.length > 0);
  const updating = pending || snapshot.draft !== url;
  const rentEnd = Math.max(RENT_MAX, Math.ceil(maxRent / 25) * 25);
  const rentStart = Math.min(RENT_MIN, maxRent);
  const surfaceEnd = Math.max(SURFACE_MAX, Math.ceil(minSurface / 5) * 5);

  return (
    <aside className="filters" aria-label="Filtres de recherche" data-expanded={expanded}>
      <div className="filters__panel">
        <div className="filters__intro">
          <Image src="/images/whoma-owner-panel.webp" alt="" fill sizes="(max-width: 1080px) 100vw, 320px" className="filters__image" />
          <span className="filters__eyebrow">Metz métropole</span>
          <h2>Votre recherche</h2>
          <button type="button" className="filters__toggle" aria-expanded={expanded} aria-controls="search-filter-fields" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Masquer' : `Filtres${activeCount ? ` (${activeCount})` : ''}`}<span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
        </div>
        <div className="filters__content" id="search-filter-fields">
          <div className="filters__head">
            <span>{activeCount ? `${activeCount} critère${activeCount > 1 ? 's' : ''} actif${activeCount > 1 ? 's' : ''}` : 'Tous les logements'}</span>
            <button type="button" className="link" onClick={reset}>Réinitialiser</button>
          </div>
          <div className="filters__fields">
            <div className="filters__block filters__block--budget">
              <div className="filters__legend">
                <label htmlFor="filter-rent">Loyer maximum</label>
                <output className="filters__range-value" htmlFor="filter-rent">{rent === null ? 'Sans plafond' : euros(rent)}</output>
              </div>
              <input id="filter-rent" className="filters__range" type="range" min={rentStart} max={rentEnd} step={25} value={maxRent}
                style={progress(maxRent, rentStart, rentEnd)} aria-label={`Loyer maximum ${includeCharges ? 'charges comprises' : 'hors charges'}`}
                aria-valuetext={rent === null ? 'Sans plafond' : euros(rent)}
                onChange={(event) => update((next) => next.set('maxRent', event.target.value), true)} />
              <div className="filters__range-bounds"><span>{euros(rentStart)}</span><button type="button" onClick={() => select('maxRent', '')}>Sans plafond</button></div>
              <label className="filters__checkbox filters__charges">
                <input type="checkbox" checked={includeCharges} onChange={(event) => select('includeCharges', event.target.checked ? '' : 'false')} />
                <span>Charges comprises</span>
              </label>
              <p className="filters__hint">{includeCharges ? 'Loyer + charges dans votre budget.' : 'Budget calculé hors charges.'} Hors honoraires.</p>
            </div>
            <div className="filters__block">
              <span className="filters__legend" id="filter-type-label">Type de logement</span>
              <div className="filters__segmented" role="group" aria-labelledby="filter-type-label">
                {[['', 'Tous'], ['APARTMENT', 'Appartement'], ['HOUSE', 'Maison']].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={propertyType === value} onClick={() => select('propertyType', value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="filters__block">
              <span className="filters__legend" id="filter-rooms-label">Nombre de pièces</span>
              <div className="filters__segmented" role="group" aria-labelledby="filter-rooms-label">
                {['', '1', '2', '3', '4+'].map((value) => (
                  <button key={value} type="button" aria-pressed={rooms === value} aria-label={value === '' ? 'Toutes les pièces' : value === '4+' ? '4 pièces et plus' : `${value} pièce${value === '1' ? '' : 's'}`}
                    onClick={() => update((next) => {
                      next.delete('minRooms'); next.delete('maxRooms');
                      if (value) next.set('minRooms', value === '4+' ? '4' : value);
                      if (value && value !== '4+') next.set('maxRooms', value);
                    })}>{value || 'Tous'}</button>
                ))}
              </div>
              {rooms === null ? <p className="filters__hint">{minRooms ? `À partir de ${minRooms} pièce(s)` : ''}{maxRooms ? ` · Jusqu’à ${maxRooms} pièce(s)` : ''}</p> : null}
            </div>
            <div className="filters__block">
              <div className="filters__legend"><label htmlFor="filter-surface">Surface minimum</label><output className="filters__range-value" htmlFor="filter-surface">{minSurface ? `${minSurface} m²` : 'Toutes'}</output></div>
              <input id="filter-surface" className="filters__range" type="range" min={SURFACE_MIN} max={surfaceEnd} step={5} value={minSurface}
                style={progress(minSurface, SURFACE_MIN, surfaceEnd)} aria-label="Surface habitable minimum" aria-valuetext={surfaceLabel(minSurface)}
                onChange={(event) => update((next) => { if (Number(event.target.value) === 0) next.delete('minSurface'); else next.set('minSurface', event.target.value); }, true)} />
              <div className="filters__range-bounds"><span>Toutes</span><span>{surfaceEnd} m²</span></div>
            </div>
            <div className="filters__block">
              <span className="filters__legend" id="filter-furnished-label">Ameublement</span>
              <div className="filters__segmented" role="group" aria-labelledby="filter-furnished-label">
                {[['all', 'Tous'], ['furnished', 'Meublé'], ['unfurnished', 'Nu']].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={furnished === value} onClick={() => select('furnished', value === 'all' ? '' : value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="filters__block filters__block--districts">
              <span className="filters__legend">Quartiers</span>
              <div className="filters__checks">
                {districts.map((district) => (
                  <label key={district.slug} className="filters__checkbox" data-checked={selectedDistricts.includes(district.slug)}>
                    <input type="checkbox" checked={selectedDistricts.includes(district.slug)} onChange={() => update((next) => {
                      const selected = (next.get('districts') ?? '').split(',').filter(Boolean);
                      const values = selected.includes(district.slug) ? selected.filter((slug) => slug !== district.slug) : [...selected, district.slug];
                      if (values.length) next.set('districts', values.join(',')); else next.delete('districts');
                    })} />
                    <span>{district.name}</span><span className="filters__district-count" aria-label={`${district.availableCount} biens dans ce quartier`}>{district.availableCount}</span>
                  </label>
                ))}
              </div>
              <p className="filters__hint">Nombre total de biens par quartier.</p>
            </div>
          </div>
          <p className="filters__status" role="status" aria-live="polite" data-pending={updating}><span aria-hidden="true" />{updating ? 'Actualisation des résultats…' : 'Résultats actualisés automatiquement'}</p>
          <button type="button" className="filters__apply btn" onClick={showResults}>Voir les résultats</button>
          <div className="filters__dossier">
            <span className="filters__dossier-icon" aria-hidden="true">▤</span>
            <div><strong>Votre dossier, une fois.</strong><p>Préparez-le pour candidater en un clic.</p><Link href="/dossier">Créer mon dossier <span aria-hidden="true">↗</span></Link></div>
          </div>
        </div>
      </div>
    </aside>
  );
}
