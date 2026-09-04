'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Plus récents' },
  { value: 'rent_asc', label: 'Loyer croissant' },
  { value: 'rent_desc', label: 'Loyer décroissant' },
  { value: 'surface_desc', label: 'Surface décroissante' },
];

/**
 * Sélecteur de tri des résultats.
 *
 * Les valeurs correspondent à l'enum `PropertySort` de l'API. « Compatibilité »
 * n'est proposé qu'au locataire : lui seul a un dossier à confronter aux
 * critères du propriétaire. Le proposer à un visiteur anonyme annoncerait un
 * tri qui retomberait sur la récence — autant ne pas le montrer.
 *
 * Il est proposé même quand le dossier est encore vide de revenus : l'API le
 * dit alors dans sa réponse, et l'écran explique ce qui manque. C'est plus
 * utile qu'une option absente sans raison visible.
 */
export function SortSelect({ compatibility }: { compatibility: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Le tri par défaut de l'API est « compatibilité » ; sans dossier à
  // confronter, elle sert la récence. Le sélecteur affiche donc ce que l'URL
  // vide produit réellement pour cette personne-là.
  const fallback = compatibility ? 'compatibility' : 'recent';
  const current = searchParams.get('sort') ?? fallback;

  const options = compatibility
    ? [{ value: 'compatibility', label: 'Compatibilité' }, ...SORT_OPTIONS]
    : SORT_OPTIONS;

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === fallback) params.delete('sort');
    else params.set('sort', value);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <select
      value={current}
      aria-label="Trier les résultats"
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
