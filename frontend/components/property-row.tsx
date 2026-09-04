import Link from 'next/link';
import type { PropertyListItem } from '@/lib/api';
import * as fmt from '@/lib/format';
import { PhotoPlaceholder } from './photo-placeholder';
import { SaveButton } from './save-button';

/**
 * Ligne de résultat de recherche.
 *
 * Le badge de la maquette porte le **statut de l'annonce** — « en ligne » ou
 * « en visite » — et non une compatibilité avec le dossier du visiteur, qui
 * n'aurait pas de sens sur un écran consultable sans compte. La compatibilité
 * arrivera avec le dossier locataire (écran 3).
 *
 * Le loyer affiché est charges comprises, avec le détail des charges en dessous :
 * c'est ce que la maquette met en gros, et ce sur quoi porte le filtre de loyer.
 */
export function PropertyRow({
  property,
  saved = false,
  role = null,
}: {
  property: PropertyListItem;
  /** Déjà mis de côté par le visiteur connecté. */
  saved?: boolean;
  role?: 'OWNER' | 'TENANT' | 'AGENT' | null;
}) {
  const visiting = property.status === 'VISITS_IN_PROGRESS';

  return (
    <Link href={`/biens/${property.reference}`} className="property-row reveal">
      {/* La vignette porte le bouton, et non la ligne entière : posé au bord
          de la ligne, il recouvrirait le bloc du loyer. */}
      <div className="property-row__media">
        <PhotoPlaceholder label={property.photoLabel} className="property-row__photo" />
        <SaveButton
          reference={property.reference}
          initiallySaved={saved}
          role={role}
          variant="icon"
        />
      </div>

      <div>
        <div className="property-row__id">
          <span className="property-row__ref">{property.reference}</span>
          <span className={visiting ? 'badge badge--pending' : 'badge badge--ok'}>
            {visiting ? 'En visite' : 'En ligne'}
          </span>
        </div>

        <div className="property-row__title">{property.title}</div>
        <div className="property-row__address">
          {property.addressLine} · {property.district.name}, {property.city}
        </div>

        <div className="property-row__specs">
          <span>{fmt.surfaceLower(property.surfaceM2)}</span>
          <span>{property.rooms} p.</span>
          {property.floor ? <span>ét. {property.floor}</span> : null}
          <span>DPE {fmt.energyRating(property.energyRating)}</span>
          <span>{fmt.furnishedLabel(property.furnished).toLowerCase()}</span>
        </div>
      </div>

      <div className="property-row__price">
        <div className="property-row__rent">{fmt.euros(property.totalRentCents)}</div>
        <div className="property-row__charges">
          dont {fmt.euros(property.chargesCents)} ch.
        </div>
        <div className="property-row__availability">
          Libre {fmt.availability(property.availableFrom, property.availableImmediately)}
        </div>
      </div>
    </Link>
  );
}
