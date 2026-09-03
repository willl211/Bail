import type { PropertyListItem } from '@/lib/api';
import * as fmt from '@/lib/format';

export interface TickerItem {
  ref: string;
  text: string;
  state?: 'ok' | 'pending';
}

/**
 * Bandeau d'activité — le registre en défilement continu.
 *
 * Les entrées sont construites à partir des annonces réellement en base, pas
 * d'un script figé : tant qu'il n'y a ni candidature ni dossier, la seule
 * activité vérifiable est la mise en ligne des biens. Le bandeau se remplira
 * de lui-même quand les écrans suivants produiront des événements.
 *
 * Le contenu est dupliqué pour que la boucle se referme sans saut ; il est
 * masqué aux lecteurs d'écran, l'information étant déjà présente dans la page.
 */
export function buildTickerItems(properties: PropertyListItem[]): TickerItem[] {
  return properties.slice(0, 8).map((property) => ({
    ref: property.reference,
    text:
      property.status === 'VISITS_IN_PROGRESS'
        ? 'visites en cours'
        : `mis en ligne · ${fmt.surfaceLower(property.surfaceM2)} · ${property.district.name}`,
    state: property.status === 'VISITS_IN_PROGRESS' ? 'pending' : 'ok',
  }));
}

export function ActivityTicker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker__track">
        {[0, 1].map((pass) =>
          items.map((item) => (
            <span
              key={`${pass}-${item.ref}`}
              className="ticker__item"
              data-state={item.state}
            >
              <i />
              <b>{item.ref}</b> {item.text}
            </span>
          )),
        )}
      </div>
    </div>
  );
}
