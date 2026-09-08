import Link from 'next/link';
import type { CurrentUser, SavedPropertyItem, TenantFileView } from '@/lib/api';
import * as fmt from '@/lib/format';
import { TenantAside } from './tenant-aside';
import { SaveButton } from './save-button';
import { OwnerPropertyPhoto } from './owner-property-photo';

export function SavedScreen({
  user,
  items,
  file,
}: {
  user: CurrentUser;
  items: SavedPropertyItem[];
  file: TenantFileView;
}) {
  const available = items.filter((item) => item.available).length;
  return (
    <div className="page tenant-page">
      <div className="app tenant-app">
        <TenantAside user={user} file={file} current="saved" savedCount={items.length} />
        <div className="body">
          <div className="page__head">
            <div>
              <span className="label label--accent">Votre sélection</span>
              <h1 className="d3 mt-8">Biens sauvegardés</h1>
              <p className="p-sm mt-12">
                {items.length
                  ? `${items.length} bien${items.length > 1 ? 's' : ''} de côté · ${available} encore disponible${available > 1 ? 's' : ''}`
                  : 'Les logements que vous souhaitez retrouver.'}
              </p>
            </div>
          </div>
          {items.length === 0 ? (
            <div className="panel pad-lg mt-24">
              <h2 className="h">Rien de côté pour l’instant</h2>
              <p className="p-sm mt-12">
                Sauvegardez un bien depuis une annonce pour le retrouver ici, sans avoir à
                candidater tout de suite.
              </p>
              <Link href="/recherche" className="btn mt-20">
                Voir les biens à Metz
              </Link>
            </div>
          ) : (
            <div className="tenant-saved-list">
              {items.map((item) => (
                <article className="tenant-saved-property" key={item.reference}>
                  <OwnerPropertyPhoto
                    src={item.photoUrl}
                    title={item.title}
                    emptyLabel="Photo indisponible"
                  />
                  <div className="tenant-saved-property__info">
                    <span className="label">
                      {item.reference} · {item.district}
                    </span>
                    <h2>{item.title}</h2>
                    <p>
                      {fmt.surfaceLower(item.surfaceM2)} ·{' '}
                      {fmt.rooms(item.rooms).toLowerCase()} ·{' '}
                      {fmt.furnishedLabel(item.furnished)} · DPE{' '}
                      {fmt.energyRating(item.energyRating)}
                    </p>
                    {item.available ? (
                      <span className="field__hint">
                        Sauvegardé {fmt.relativeAge(item.savedAt).toLowerCase()}
                      </span>
                    ) : (
                      <span className="badge badge--mute">
                        {item.status === 'RENTED' ? 'Loué' : 'Retiré de la diffusion'}
                      </span>
                    )}
                  </div>
                  <div className="tenant-saved-property__actions">
                    <div>
                      <strong>{fmt.euros(item.totalRentCents)}</strong>
                      <span> / mois CC</span>
                    </div>
                    <div className="flex ai-c gap-12">
                      {item.available ? (
                        <Link
                          href={`/biens/${encodeURIComponent(item.reference)}`}
                          className="btn btn-sm"
                        >
                          Voir l’annonce
                        </Link>
                      ) : null}
                      <SaveButton
                        reference={item.reference}
                        initiallySaved
                        role={user.role}
                        variant="inline"
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="field__hint mt-20">
            Votre sélection est privée. Les propriétaires ne voient pas qui sauvegarde leur
            bien.
          </p>
        </div>
      </div>
    </div>
  );
}
