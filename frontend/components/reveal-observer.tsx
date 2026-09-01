'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Révélation à l'entrée dans le champ de vision.
 *
 * Un seul observateur pour toute la page : les composants serveur posent la
 * classe `reveal`, ce composant leur ajoute `data-shown` quand ils arrivent à
 * l'écran, avec un décalage de 70 ms entre éléments d'un même lot — comme dans
 * la maquette. Rien n'est animé au-delà : l'animation est délibérée, pas
 * systématique (docs/design-system.md).
 */
export function RevealObserver() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      document
        .querySelectorAll('.reveal:not([data-shown])')
        .forEach((element) => element.setAttribute('data-shown', '1'));
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    const observer = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach((entry, index) => {
            const element = entry.target;
            timers.push(setTimeout(() => element.setAttribute('data-shown', '1'), index * 70));
            observer.unobserve(element);
          });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );

    const frame = requestAnimationFrame(() => {
      document
        .querySelectorAll('.reveal:not([data-shown])')
        .forEach((element) => observer.observe(element));
    });

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      observer.disconnect();
    };
  }, [pathname, searchParams]);

  return null;
}
