import Link from 'next/link';
import { ScrollProgress } from './scroll-progress';

/**
 * En-tête collant.
 *
 * La maquette porte en plus un sélecteur « 01 ACCUEIL / 02 RÉSULTATS / 03 FICHE
 * BIEN / 04 ESPACE LOCATAIRE » : c'est le navigateur d'artboards du prototype,
 * pas un composant produit. Il n'est donc pas repris ; le reste de l'en-tête
 * (marque, lien propriétaire, bouton d'appel à l'action) l'est à l'identique.
 */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__brand">
          <span className="site-header__wordmark">SEUIL</span>
          <span className="site-header__locality">METZ · 57000</span>
        </Link>

        <nav className="site-header__nav">
          <Link href="/proprietaires" className="site-header__link">
            Espace propriétaire
          </Link>
          <Link href="/dossier" className="btn btn-sm">
            Créer mon dossier
          </Link>
        </nav>
      </div>
      <ScrollProgress />
    </header>
  );
}
