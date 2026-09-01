'use client';

import { useEffect } from 'react';

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
        <h1 className="notice__title">Les annonces ne peuvent pas être chargées</h1>
        <p className="notice__text">
          L&apos;API n&apos;a pas répondu. En développement, vérifiez que la base et le backend
          tournent :
        </p>
        <code className="notice__code">{`npm run db:up\nnpm run dev:backend`}</code>
        <p className="notice__text" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-sm" onClick={reset}>
            Réessayer
          </button>
        </p>
      </div>
    </main>
  );
}
