'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Écran d'erreur.
 *
 * Le cas le plus fréquent en développement est un backend non démarré : le
 * message le dit explicitement plutôt que d'afficher une page blanche.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <div className="notice">
        <h1 className="notice__title">Cette page est momentanément indisponible</h1>
        <p className="notice__text">
          Nous n’avons pas pu charger les informations. Réessayez dans quelques instants.
        </p>
        <div className="flex gap-12 wrap ai-c mt-16">
          <button type="button" className="btn btn-sm" onClick={reset}>
            Réessayer
          </button>
          <Link href="/" className="link">Retour à l’accueil</Link>
        </div>
      </div>
    </main>
  );
}
