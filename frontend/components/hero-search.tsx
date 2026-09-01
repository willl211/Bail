'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { District } from '@/lib/api';

const RENT_STEPS = [600, 800, 1000, 1200, 1400, 1600];

const ROOM_RANGES = [
  { label: 'Toutes', value: '', min: undefined, max: undefined },
  { label: '1', value: '1', min: 1, max: 1 },
  { label: '2 — 3', value: '2-3', min: 2, max: 3 },
  { label: '4 +', value: '4+', min: 4, max: undefined },
];

/**
 * Barre de recherche de la page d'accueil.
 *
 * Dans la maquette, « LOYER MAX » et « PIÈCES » sont des valeurs figées : c'est
 * un raccourci de prototype. Ici ce sont des listes déroulantes sans bordure ni
 * fond, ce qui laisse le rendu identique tout en rendant la barre utilisable.
 */
export function HeroSearch({ districts }: { districts: District[] }) {
  const router = useRouter();
  const [district, setDistrict] = useState('');
  const [maxRent, setMaxRent] = useState('1200');
  const [roomRange, setRoomRange] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (district) params.set('districts', district);
    if (maxRent) params.set('maxRent', maxRent);

    const range = ROOM_RANGES.find((entry) => entry.value === roomRange);
    if (range?.min) params.set('minRooms', String(range.min));
    if (range?.max) params.set('maxRooms', String(range.max));

    router.push(`/recherche?${params.toString()}`);
  };

  return (
    <form className="searchbar" onSubmit={submit}>
      <label className="searchbar__field searchbar__field--wide">
        <span className="searchbar__legend">QUARTIER</span>
        <select
          className="searchbar__select"
          value={district}
          onChange={(event) => setDistrict(event.target.value)}
        >
          <option value="">Tous les quartiers</option>
          {districts.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>

      <label className="searchbar__field">
        <span className="searchbar__legend">LOYER MAX</span>
        <select
          className="searchbar__value"
          value={maxRent}
          onChange={(event) => setMaxRent(event.target.value)}
        >
          {RENT_STEPS.map((step) => (
            <option key={step} value={step}>
              {step.toLocaleString('fr-FR')} €
            </option>
          ))}
        </select>
      </label>

      <label className="searchbar__field">
        <span className="searchbar__legend">PIÈCES</span>
        <select
          className="searchbar__value"
          value={roomRange}
          onChange={(event) => setRoomRange(event.target.value)}
        >
          {ROOM_RANGES.map((range) => (
            <option key={range.label} value={range.value}>
              {range.label}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="btn searchbar__submit">
        Rechercher
      </button>
    </form>
  );
}
