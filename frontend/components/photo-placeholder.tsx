/**
 * Emplacement photo : aplat rayé à 135°, légende en bas à gauche et barre
 * d'échelle en bas à droite — le fond de plan de la maquette.
 *
 * Les vraies photos arriveront avec le dépôt d'annonce (écran 2 du
 * build-order). En attendant, on reproduit exactement le traitement de la
 * maquette plutôt que d'insérer une image d'illustration générique.
 */
export function PhotoPlaceholder({
  label,
  className,
  scale = false,
  badge,
}: {
  label: string;
  className?: string;
  /** Barre d'échelle « 2 m » — réservée aux vues principales, comme en maquette. */
  scale?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className={className ? `photo ${className}` : 'photo'} role="img" aria-label={label}>
      <span className="photo-caption">{label}</span>
      {scale ? <span className="photo-scale">2 m</span> : null}
      {badge}
    </div>
  );
}
