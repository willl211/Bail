'use client';

import { usePathname } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';

/** Même navigation pour toutes les tailles ; le menu se replie sur téléphone. */
export function SiteNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menu, setMenu] = useState({ pathname, open: false });
  const toggle = useRef<HTMLButtonElement>(null);
  const open = menu.pathname === pathname && menu.open;
  const close = () => setMenu({ pathname, open: false });

  return (
    <div className="site-navigation" data-expanded={open}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          close();
          toggle.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}>
      <button ref={toggle} type="button" className="site-navigation__toggle"
        aria-expanded={open} aria-controls="primary-navigation"
        onClick={() => setMenu({ pathname, open: !open })}>
        {open ? 'Fermer' : 'Menu'} <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <nav id="primary-navigation" className="site-header__nav" aria-label="Navigation principale"
        onClick={(event) => {
          if ((event.target as Element).closest('a')) close();
        }}>
        {children}
      </nav>
    </div>
  );
}
