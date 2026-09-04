import Link from 'next/link';
import type { PropertyListItem } from '@/lib/api';
import * as fmt from '@/lib/format';
import { PhotoPlaceholder } from './photo-placeholder';
import { SaveButton } from './save-button';

/**
 * Carte de bien du bloc « Biens en avant à Metz » (page d'accueil).
 *
 * Comme en maquette : le loyer affiché est **charges comprises** — c'est la
 * somme que le locataire paiera, et la seule que la fiche met en gros. La
 * référence n'occupe pas la ligne de métadonnées : elle apparaît en surimpression
 * au survol, ce qui accuse réception du pointage sans charger la carte au repos.
 */
export function PropertyCard({
  property,
  saved = false,
  role = null,
}: {
  property: PropertyListItem;
  /** Déjà mis de côté par le visiteur connecté. */
  saved?: boolean;
  role?: 'OWNER' | 'TENANT' | 'AGENT' | null;
}) {
  return (
    <Link href={`/biens/${property.reference}`} className="property-card reveal">
      <span className="property-card__ref">{property.reference}</span>

      <SaveButton
        reference={property.reference}
        initiallySaved={saved}
        role={role}
        variant="icon"
      />

      <PhotoPlaceholder
        label={property.photoLabel}
        className="property-card__photo"
        scale
      />

      <div className="property-card__body">
        <div className="property-card__head">
          <span className="property-card__title">{property.title}</span>
          <span className="property-card__rent">{fmt.euros(property.totalRentCents)}</span>
        </div>

        <div className="property-card__meta">
          {property.addressLine} · {property.district.name}
        </div>

        <div className="property-card__specs">
          <div className="property-card__spec">
            <span className="label">Surface</span>
            <div className="property-card__spec-value">
              {fmt.surfaceLower(property.surfaceM2)}
            </div>
          </div>
          <div className="property-card__spec">
            <span className="label">Pièces</span>
            <div className="property-card__spec-value">{property.rooms}</div>
          </div>
          <div className="property-card__spec">
            <span className="label">DPE</span>
            <div className="property-card__spec-value">{fmt.energyRating(property.energyRating)}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
