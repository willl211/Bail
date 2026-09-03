import Link from 'next/link';
import { ScrollProgress } from './scroll-progress';
import { getCurrentUser, type CurrentUser } from '@/lib/api';

interface NavLink {
  label: string;
  href: string;
}

interface Profile {
  links: NavLink[];
  /** Appel à l'action pour un visiteur ; identité pour un compte connecté. */
  cta?: NavLink;
  secondary?: NavLink;
  account?: { name: string; initials: string; href: string };
  /** Le back-office annonce son contexte à la place de la ville. */
  internal?: boolean;
}

const initialsOf = (user: CurrentUser) =>
  `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

/**
 * Navigation selon le profil connecté, comme dans la maquette (`PROFILES`).
 *
 * Ce n'est qu'un reflet de la décision d'accès : le contrôle réel est le guard
 * de rôle côté API. Masquer un lien ne protège rien — `/proprietaires/biens`
 * répond 403 à un locataire qui saisit l'URL (docs/tech-stack.md).
 */
function profileFor(user: CurrentUser | null): Profile {
  if (!user) {
    return {
      links: [
        { label: 'Rechercher', href: '/recherche' },
        { label: 'Louer sans agence', href: '/proprietaires' },
      ],
      secondary: { label: 'Se connecter', href: '/dossier' },
      cta: { label: 'Créer mon dossier', href: '/dossier' },
    };
  }

  const account = {
    name: `${user.firstName} ${user.lastName}`,
    initials: initialsOf(user),
    href: '/',
  };

  if (user.role === 'OWNER') {
    return {
      links: [
        { label: 'Rechercher', href: '/recherche' },
        { label: 'Mes biens', href: '/proprietaires/biens' },
        { label: 'Candidatures', href: '/proprietaires/candidatures' },
        { label: 'Abonnement', href: '/proprietaires/abonnement' },
      ],
      account: { ...account, href: '/proprietaires/biens' },
    };
  }

  if (user.role === 'AGENT') {
    return {
      links: [{ label: 'Registre', href: '/back-office' }],
      account: { ...account, href: '/back-office' },
      internal: true,
    };
  }

  return {
    links: [
      { label: 'Rechercher', href: '/recherche' },
      { label: 'Mon dossier', href: '/dossier' },
    ],
    account: { ...account, href: '/dossier' },
  };
}

export async function SiteHeader() {
  const user = await getCurrentUser();
  const profile = profileFor(user);

  return (
    <header className={profile.internal ? 'site-header site-header--internal' : 'site-header'}>
      <div className="site-header__inner">
        <Link href="/" className="site-header__brand">
          <span className="site-header__wordmark">BAIL</span>
          {profile.internal ? (
            <span className="site-header__tag">Accès interne</span>
          ) : (
            <span className="site-header__locality">METZ · 57000</span>
          )}
        </Link>

        <nav className="site-header__nav">
          {profile.links.map((link) => (
            <Link key={link.href + link.label} href={link.href} className="site-header__link">
              {link.label}
            </Link>
          ))}

          {profile.secondary ? (
            <Link href={profile.secondary.href} className="site-header__link">
              {profile.secondary.label}
            </Link>
          ) : null}

          {profile.cta ? (
            <Link href={profile.cta.href} className="btn btn-sm">
              {profile.cta.label}
            </Link>
          ) : null}

          {profile.account ? (
            <Link href={profile.account.href} className="site-header__account">
              <span className="site-header__avatar">{profile.account.initials}</span>
              <span className="site-header__account-name">{profile.account.name}</span>
            </Link>
          ) : null}
        </nav>
      </div>
      <ScrollProgress />
    </header>
  );
}
