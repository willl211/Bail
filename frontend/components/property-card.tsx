import Link from 'next/link';
import type { PropertyListItem } from '@/lib/api';
import * as fmt from '@/lib/format';
import { PhotoPlaceholder } from './photo-placeholder';

/**
 * Carte de bien du bloc « Biens en avant à Metz » (page d'accueil).
 *
 * Le badge « VÉRIFIÉ » de la maquette porte sur l'annonce : un bien n'est mis
 * en ligne qu'après contrôle (statut ONLINE), donc toute carte affichée le
 * porte. Il ne préjuge pas de la vérification du dossier locataire, qui est un
 * autre objet.
 */
export function PropertyCard({ property }: { property: PropertyListItem }) {
  return (
    <Link href={`/biens/${property.reference}`} className="property-card reveal">
      <PhotoPlaceholder
        label={property.photoLabel}
        className="property-card__photo"
        badge={<span className="badge badge-solid">VÉRIFIÉ</span>}
      />

      <div className="property-card__body">
        <div className="property-card__head">
          <span className="property-card__title">{property.title}</span>
          <span className="property-card__rent">{fmt.euros(property.rentCents)}</span>
        </div>

        <div className="property-card__meta">
          {property.district.name} · {property.reference}
        </div>

        <div className="property-card__specs">
          <div className="property-card__spec">
            <div className="label-xs">SURFACE</div>
            <div className="property-card__spec-value">{fmt.surface(property.surfaceM2)}</div>
          </div>
          <div className="property-card__spec">
            <div className="label-xs">MEUBLÉ</div>
            <div className="property-card__spec-value">{fmt.furnished(property.furnished)}</div>
          </div>
          <div className="property-card__spec">
            <div className="label-xs">DPE</div>
            <div className="property-card__spec-value">{property.energyRating}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
