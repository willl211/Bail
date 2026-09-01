'use client';

import { useEffect, useRef } from 'react';

/**
 * Filet de progression de lecture sous l'en-tête (2 px, accent).
 * Repris tel quel de la maquette : `barRef` + écouteur de défilement passif.
 */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const ratio = doc.scrollTop / Math.max(1, doc.scrollHeight - doc.clientHeight);
      if (bar.current) {
        bar.current.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
      }
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="site-header__progress">
      <div ref={bar} className="site-header__progress-bar" />
    </div>
  );
}
