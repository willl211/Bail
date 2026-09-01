'use client';

import { useEffect, useState } from 'react';

/**
 * Compteur animé de la page d'accueil (nombre de biens vérifiés).
 * Courbe et durée reprises de la maquette : ease-out cubique sur 1 300 ms.
 */
export function AnimatedCounter({ target }: { target: number }) {
  // On part de la valeur finale : le rendu serveur (et l'affichage sans
  // JavaScript) montre le bon chiffre, jamais un zéro. L'animation ne démarre
  // qu'une fois le composant monté côté client.
  const [value, setValue] = useState(target);

  useEffect(() => {
    // L'état part déjà de `target` : quand l'utilisateur demande un mouvement
    // réduit, il n'y a rien à faire, le bon chiffre est déjà affiché.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const start = performance.now();
    const duration = 1300;

    const step = () => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return <>{value.toLocaleString('fr-FR')}</>;
}
