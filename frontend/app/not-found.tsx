import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page">
      <div className="notice">
        <div className="label" style={{ marginBottom: 12 }}>
          ERREUR 404
        </div>
        <h1 className="notice__title">Cette annonce n&apos;est plus en ligne</h1>
        <p className="notice__text">
          Le bien a peut-être été loué ou retiré par son propriétaire. Les autres biens disponibles
          à Metz restent consultables.
        </p>
        <p className="notice__text" style={{ marginTop: 18 }}>
          <Link href="/recherche">← Voir les biens à louer</Link>
        </p>
      </div>
    </main>
  );
}
