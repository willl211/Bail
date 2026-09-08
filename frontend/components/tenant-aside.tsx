import Image from 'next/image';
import Link from 'next/link';
import type { CurrentUser, TenantFileView } from '@/lib/api';
import * as fmt from '@/lib/format';
import { LogoutButton } from './logout-button';

export function TenantAside({
  user,
  file,
  current,
  savedCount,
}: {
  user: CurrentUser;
  file: Pick<
    TenantFileView,
    'reference' | 'verifiedSlotCount' | 'expectedSlotCount' | 'maxRentCents'
  >;
  current: 'file' | 'saved';
  savedCount?: number;
}) {
  return (
    <aside className="aside tenant-aside">
      <div className="tenant-aside__scene" aria-hidden="true">
        <Image
          src="/images/whoma-owner-panel.webp"
          alt=""
          fill
          sizes="(max-width: 860px) 100vw, 340px"
        />
        <span>Votre prochain chez-vous.</span>
      </div>
      <div className="aside__who">
        <span className="tenant-aside__initials" aria-hidden="true">
          {user.firstName.charAt(0)}
          {user.lastName.charAt(0)}
        </span>
        <span className="label label--accent">Locataire</span>
        <div className="aside__name">
          {user.firstName} {user.lastName}
        </div>
        <div className="aside__meta">{file.reference}</div>
      </div>
      <nav className="aside__nav" aria-label="Espace locataire">
        <Link
          href="/dossier"
          className="aside__item"
          aria-current={current === 'file' ? 'page' : undefined}
        >
          Mon dossier
        </Link>
        <Link
          href="/dossier/sauvegardes"
          className="aside__item"
          aria-current={current === 'saved' ? 'page' : undefined}
        >
          Biens sauvegardés{' '}
          {savedCount === undefined ? null : (
            <span className="aside__count">{savedCount}</span>
          )}
        </Link>
      </nav>
      <div className="aside__block">
        <span className="label label--ink">Loyer conseillé</span>
        <p className="p-sm mt-8">
          {file.maxRentCents === null ? (
            'À estimer avec vos revenus.'
          ) : (
            <>
              <strong>{fmt.euros(file.maxRentCents)}</strong> charges comprises
            </>
          )}
        </p>
        <LogoutButton />
      </div>
    </aside>
  );
}
