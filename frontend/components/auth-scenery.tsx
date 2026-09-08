import Image from 'next/image';
import type { ReactNode } from 'react';

export function AuthScenery({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="auth-scenery">
      <div className="auth-scenery__image">
        <Image
          src="/images/whoma-owner-panel.webp"
          alt=""
          fill
          sizes="(max-width: 860px) 100vw, 50vw"
        />
        <span className="auth-scenery__signature">WHOMA · HABITER SIMPLEMENT</span>
      </div>
      <div className="auth-scenery__content">
        <h2>{title}</h2>
        {children}
      </div>
      <div className="auth-scenery__footer">
        <span aria-hidden="true">■</span> Un lieu à soi. Un quotidien plus simple.
      </div>
    </aside>
  );
}
