'use client';

import { useState } from 'react';

/** Les photos proviennent du stockage configuré ; un fichier absent garde sa place. */
export function OwnerPropertyPhoto({
  src,
  title,
  emptyLabel = 'Photo à ajouter',
}: {
  src: string | null;
  title: string;
  emptyLabel?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <div className="owner-property-photo">
      {src && src !== failedSrc ? (
        // Les domaines de stockage changent suivant l'environnement.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title}
          loading="lazy"
          onError={() => setFailedSrc(src)}
          ref={(node) => {
            // Une image servie par le serveur peut avoir échoué avant l'hydratation.
            if (node?.complete && node.naturalWidth === 0) setFailedSrc(src);
          }}
        />
      ) : (
        <div className="owner-property-photo__empty" aria-label={`${emptyLabel} : ${title}`}>
          <svg viewBox="0 0 48 40" fill="none" aria-hidden="true">
            <path d="M7 12h9l3-5h10l3 5h9v23H7V12Z" />
            <circle cx="24" cy="23" r="7" />
            <path d="M34 17h3" />
          </svg>
          <span>{emptyLabel}</span>
        </div>
      )}
    </div>
  );
}
