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
 *
 * Un filet de sécurité double l'observateur : `IntersectionObserver` ne signale
 * rien quand un élément est franchi d'un seul bond (lien ancré, position de
 * défilement restaurée, `scrollTo`, molette rapide). Sans ce rattrapage, un bloc
 * sauté reste invisible **définitivement** — le contenu disparaît pour de bon,
 * ce qui est bien pire que de rater une animation.
 */
export function RevealObserver() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const reveal = (element: Element) => element.setAttribute('data-shown', '1');
    const hidden = () => document.querySelectorAll('.reveal:not([data-shown])');

    if (!('IntersectionObserver' in window)) {
      hidden().forEach(reveal);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    const observer = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach((entry, index) => {
            const element = entry.target;
            timers.push(setTimeout(() => reveal(element), index * 70));
            observer.unobserve(element);
          });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );

    /** Affiche sans attendre tout ce qui est déjà passé au-dessus du pli. */
    const catchUp = () => {
      hidden().forEach((element) => {
        if (element.getBoundingClientRect().bottom <= 0) {
          observer.unobserve(element);
          reveal(element);
        }
      });
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        catchUp();
      });
    };

    const frame = requestAnimationFrame(() => {
      hidden().forEach((element) => observer.observe(element));
      catchUp();
    });

    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      window.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [pathname, searchParams]);

  return null;
}
