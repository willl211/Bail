'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Sélecteur de tri des résultats.
 *
 * Les valeurs correspondent à l'enum `PropertySort` de l'API. « Compatibilité »
 * n'est pas proposé ici : sans dossier locataire, il n'a rien à confronter aux
 * critères du propriétaire et retomberait sur la récence — l'annoncer serait
 * mentir sur ce que fait le tri. Il apparaîtra avec le dossier (écran 3).
 */
const SORT_OPTIONS = [
  { value: 'recent', label: 'Plus récents' },
  { value: 'rent_asc', label: 'Loyer croissant' },
  { value: 'rent_desc', label: 'Loyer décroissant' },
  { value: 'surface_desc', label: 'Surface décroissante' },
];

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const current = searchParams.get('sort') ?? 'recent';

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'recent') params.delete('sort');
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
      {SORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
