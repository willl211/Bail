import Link from 'next/link';
import type { PropertyListItem } from '@/lib/api';
import * as fmt from '@/lib/format';
import { PhotoPlaceholder } from './photo-placeholder';

/**
 * Ligne de résultat de recherche.
 *
 * La maquette affiche ici un badge « DOSSIER COMPATIBLE » / « REVENUS À
 * CONFIRMER ». Cette pastille compare le dossier du locataire connecté aux
 * critères du propriétaire : elle n'a pas de sens sur un écran consultable sans
 * compte. Elle est donc remplacée, au même emplacement et dans le même style,
 * par le type de bail — l'information disponible et utile à ce stade. Elle
 * reprendra sa fonction dès que le dossier locataire existera (écran 3).
 */
export function PropertyRow({ property }: { property: PropertyListItem }) {
  return (
    <Link href={`/biens/${property.reference}`} className="property-row reveal">
      <PhotoPlaceholder label={property.photoLabel} className="property-row__photo" />

      <div className="property-row__main">
        <div className="property-row__id">
          <span className="property-row__ref">{property.reference}</span>
          <span className="badge badge-outline">
            {property.furnished ? 'BAIL MEUBLÉ' : 'BAIL NU'}
          </span>
        </div>

        <div className="property-row__title">{property.title}</div>
        <div className="property-row__address">
          {property.district.name} · {property.addressLine}
        </div>

        <div className="property-row__specs">
          <span>{fmt.surface(property.surfaceM2)}</span>
          <span>{fmt.rooms(property.rooms)}</span>
          {property.floor ? <span>ÉTAGE {property.floor.toUpperCase()}</span> : null}
          <span>DPE {property.energyRating}</span>
          <span>{fmt.furnished(property.furnished)}</span>
        </div>
      </div>

      <div className="property-row__price">
        <div className="property-row__rent">{fmt.euros(property.rentCents)}</div>
        <div className="property-row__charges">+ {fmt.euros(property.chargesCents)} CH.</div>
        <div className="property-row__availability">
          LIBRE {fmt.availability(property.availableFrom, property.availableImmediately)}
        </div>
      </div>
    </Link>
  );
}
