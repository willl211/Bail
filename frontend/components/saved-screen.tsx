import Link from 'next/link';
import type { CurrentUser, SavedPropertyItem } from '@/lib/api';
import * as fmt from '@/lib/format';
import { LogoutButton } from './logout-button';
import { SaveButton } from './save-button';

/**
 * Biens mis de côté par le locataire.
 *
 * Un bien loué ou retiré **reste** dans la liste, avec une mention : le faire
 * disparaître laisserait croire à un défaut, et priverait le locataire de
 * l'information qui compte — ce logement n'est plus à prendre.
 */
export function SavedScreen({
  user,
  items,
}: {
  user: CurrentUser;
  items: SavedPropertyItem[];
}) {
  const disponibles = items.filter((item) => item.available).length;

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="app">
        <aside className="aside">
          <div className="aside__who">
            <span className="label label--accent">Locataire</span>
            <div className="aside__name">
              {user.firstName} {user.lastName}
            </div>
            <div className="aside__meta">{user.email}</div>
          </div>

          <nav className="aside__nav">
            <Link href="/dossier" className="aside__item">
              Mon dossier
            </Link>
            <Link href="/dossier/sauvegardes" className="aside__item" aria-current="true">
              Biens sauvegardés
              <span className="aside__count">{items.length}</span>
            </Link>
            <Link href="/recherche" className="aside__item">
              Rechercher un bien
            </Link>
          </nav>

          <LogoutButton />
        </aside>

        <div className="body">
          <div className="page__head">
            <div>
              <span className="label label--accent">Espace locataire</span>
              <h1 className="d3 mt-8">Biens sauvegardés</h1>
            </div>

            {items.length > 0 ? (
              <div className="stats">
                <div>
                  <span className="label">Sauvegardés</span>
                  <div className="stat__value">{items.length}</div>
                </div>
                <div>
                  <span className="label">Encore disponibles</span>
                  <div className="stat__value accent">{disponibles}</div>
                </div>
              </div>
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className="panel pad-lg mt-24">
              <span className="label label--accent">Liste vide</span>
              <h2 className="h mt-8">Rien de côté pour l’instant</h2>
              <p className="p-sm mt-12">
                Sauvegardez un bien depuis une annonce pour le retrouver ici, sans
                avoir à candidater tout de suite. Personne d’autre que vous ne voit
                cette liste.
              </p>
              <Link href="/recherche" className="btn mt-20">
                Voir les biens à Metz
              </Link>
            </div>
          ) : (
            <>
              <div className="panel panel--strong mt-24">
                {items.map((item) => (
                  <div key={item.reference} className="doc">
                    <div className="doc__head">
                      <div>
                        <div className="doc__n">
                          {item.reference} — {item.title}
                        </div>
                        <div className="doc__m">
                          {item.district} · {fmt.surfaceLower(item.surfaceM2)} ·{' '}
                          {fmt.rooms(item.rooms).toLowerCase()} ·{' '}
                          {fmt.furnishedLabel(item.furnished)} · DPE{' '}
                          {fmt.energyRating(item.energyRating)}
                        </div>
                      </div>

                      <div className="doc__c">
                        {item.available ? (
                          <>Sauvegardé {fmt.relativeAge(item.savedAt).toLowerCase()}</>
                        ) : (
                          // Le locataire doit comprendre pourquoi il ne peut plus
                          // candidater, plutôt que de buter sur un bouton absent.
                          <span className="badge badge--mute">
                            {item.status === 'RENTED' ? 'Loué' : 'Retiré de la diffusion'}
                          </span>
                        )}
                      </div>

                      <div className="doc__a">
                        <span className="pay__v">{fmt.euros(item.totalRentCents)}</span>
                        {item.available ? (
                          <Link href={`/biens/${item.reference}`} className="btn btn-sm">
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
                  </div>
                ))}
              </div>

              <p className="field__hint mt-12">
                Cette liste n’est visible que de vous. Les propriétaires savent
                seulement <b>combien</b> de personnes ont mis leur bien de côté,
                jamais lesquelles.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
