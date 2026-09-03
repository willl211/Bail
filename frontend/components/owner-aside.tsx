import Link from 'next/link';
import type { CurrentUser, OwnerSummary } from '@/lib/api';
import * as fmt from '@/lib/format';
import { LogoutButton } from './logout-button';

/**
 * Barre latérale de l'espace propriétaire.
 *
 * Les compteurs viennent de l'API, pas de valeurs figées : afficher « 3 biens »
 * en dur donnerait un chiffre faux dès la première annonce déposée.
 */
export function OwnerAside({
  user,
  summary,
  current,
}: {
  user: CurrentUser;
  summary: OwnerSummary;
  current: 'properties' | 'applications' | 'subscription';
}) {
  const items = [
    {
      key: 'properties' as const,
      label: 'Mes biens',
      href: '/proprietaires/biens',
      count: summary.totalCount,
    },
    {
      key: 'applications' as const,
      label: 'Candidatures',
      href: '/proprietaires/candidatures',
      count: summary.applicationCount,
    },
    {
      key: 'subscription' as const,
      label: 'Abonnement',
      href: '/proprietaires/abonnement',
      count: null,
    },
  ];

  return (
    <aside className="aside">
      <div className="aside__who">
        <span className="label label--accent">Propriétaire</span>
        <div className="aside__name">
          {user.firstName} {user.lastName}
        </div>
        <div className="aside__meta">{user.email}</div>
      </div>

      <nav className="aside__nav">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="aside__item"
            aria-current={item.key === current ? 'true' : undefined}
          >
            {item.label}
            {item.count !== null ? (
              <span className="aside__count">{item.count}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="aside__block">
        <span className="label label--ink">Abonnement</span>
        <p className="p-sm mt-8">
          {summary.monthlyCostCents === null
            ? 'Barème non configuré.'
            : `${fmt.euros(summary.monthlyCostCents)} par mois · ${summary.onlineCount} bien${summary.onlineCount > 1 ? 's' : ''} diffusé${summary.onlineCount > 1 ? 's' : ''}`}
        </p>
        <LogoutButton />
      </div>
    </aside>
  );
}
