import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span className="site-footer__mark">
        SEUIL · LOCATION LONGUE DURÉE EN DIRECT · METZ 2026
      </span>
      <span className="site-footer__links">
        <Link href="/proprietaires">Propriétaires</Link>
        <Link href="/dossier">Locataires</Link>
        <Link href="/verification">Vérification</Link>
        <Link href="/mentions-legales">Mentions légales</Link>
      </span>
    </footer>
  );
}
