import Link from 'next/link';

/**
 * Écran encore à construire.
 *
 * L'ordre de construction est imposé (docs/build-order.md) : un écran doit être
 * fonctionnel avant de passer au suivant. Ces pages existent pour que la
 * navigation de l'écran 1 ne mène nulle part en 404, pas pour préfigurer les
 * suivants.
 */
export function UpcomingScreen({
  step,
  title,
  text,
}: {
  step: string;
  title: string;
  text: string;
}) {
  return (
    <main className="page">
      <div className="notice">
        <div className="label" style={{ marginBottom: 12 }}>
          {step}
        </div>
        <h1 className="notice__title">{title}</h1>
        <p className="notice__text">{text}</p>
        <p className="notice__text" style={{ marginTop: 18 }}>
          <Link href="/recherche">← Revenir aux biens à louer</Link>
        </p>
      </div>
    </main>
  );
}
