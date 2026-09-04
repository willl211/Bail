'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { District } from '@/lib/api';

/** Comparaison indifférente à la casse et aux accents. */
const normalise = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Barre de recherche de la page d'accueil.
 *
 * Les trois champs se **saisissent**, ils ne se choisissent plus dans une liste
 * fermée : on tape un loyer, un nombre de pièces, un début de quartier. Des
 * listes déroulantes obligeaient à s'accommoder de paliers arbitraires — 800 ou
 * 1 000 €, jamais 950 — alors que c'est le visiteur qui connaît son budget.
 *
 * Le quartier garde une liste de suggestions : le filtre porte sur un
 * référentiel fermé côté API, et un nom inventé ne renverrait rien. Plutôt que
 * de chercher sur tout le portefeuille en faisant croire au filtre, la saisie
 * inconnue est refusée avec son motif.
 *
 * Les champs vides ne filtrent pas. C'est ce qu'attend quelqu'un qui efface une
 * valeur, et ça évite qu'un critère oublié masque des annonces en silence.
 */
export function HeroSearch({ districts }: { districts: District[] }) {
  const router = useRouter();
  const listId = useId();

  const [district, setDistrict] = useState('');
  const [maxRent, setMaxRent] = useState('1200');
  const [minRooms, setMinRooms] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();

    if (district.trim()) {
      const match = districts.find(
        (entry) => normalise(entry.name) === normalise(district),
      );
      if (!match) {
        setError(`Aucun quartier « ${district.trim()} » à Metz.`);
        return;
      }
      params.set('districts', match.slug);
    }

    const rent = Number(maxRent);
    if (maxRent.trim() && Number.isFinite(rent) && rent > 0) {
      params.set('maxRent', String(Math.round(rent)));
    }

    const rooms = Number(minRooms);
    if (minRooms.trim() && Number.isFinite(rooms) && rooms > 0) {
      params.set('minRooms', String(Math.round(rooms)));
    }

    setError(null);
    // Sans critère on va sur la recherche nue : « /recherche? » traînerait un
    // point d'interrogation vide dans la barre d'adresse et dans les partages.
    const query = params.toString();
    router.push(query ? `/recherche?${query}` : '/recherche');
  };

  return (
    <form className="searchbar" onSubmit={submit} noValidate>
      <label className="searchbar__field searchbar__field--wide">
        <span className="searchbar__legend">QUARTIER</span>
        <input
          className="searchbar__value"
          list={listId}
          value={district}
          placeholder="Tous les quartiers"
          autoComplete="off"
          onChange={(event) => {
            setDistrict(event.target.value);
            setError(null);
          }}
        />
        <datalist id={listId}>
          {districts.map((entry) => (
            <option key={entry.slug} value={entry.name} />
          ))}
        </datalist>
      </label>

      <label className="searchbar__field">
        <span className="searchbar__legend">LOYER MAX</span>
        <span className="searchbar__unit">
          <input
            className="searchbar__value"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            step={50}
            value={maxRent}
            placeholder="Sans limite"
            // La largeur suit la saisie pour que l'unité reste collée à la
            // valeur : « 950 € » se lit d'un bloc, « 950      € » en deux fois.
            // La police est à chasse fixe, donc `ch` tombe juste.
            style={{ width: `${Math.max(maxRent.length, 4)}ch` }}
            onChange={(event) => setMaxRent(event.target.value)}
          />
          {maxRent.trim() ? <span aria-hidden>€</span> : null}
        </span>
      </label>

      <label className="searchbar__field">
        {/* « MIN » et non « PIÈCES » seul : une valeur saisie librement doit
            dire si elle vaut pour un seuil ou pour une égalité. La maquette
            n'avait pas à trancher, ses paliers étaient figés. */}
        <span className="searchbar__legend">PIÈCES MIN</span>
        <input
          className="searchbar__value"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          step={1}
          value={minRooms}
          placeholder="Toutes"
          onChange={(event) => setMinRooms(event.target.value)}
        />
      </label>

      <button type="submit" className="btn searchbar__submit">
        Rechercher
      </button>

      {error ? (
        <p className="searchbar__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
