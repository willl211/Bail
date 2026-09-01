/**
 * Emplacement photo : aplat rayé à 135° et intitulé en bas à gauche.
 *
 * Les vraies photos arriveront avec le dépôt d'annonce (écran 2 du
 * build-order). En attendant, on reproduit exactement le traitement de la
 * maquette plutôt que d'insérer une image d'illustration générique.
 */
export function PhotoPlaceholder({
  label,
  className,
  badge,
}: {
  label: string;
  className?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className={className ? `photo ${className}` : 'photo'} role="img" aria-label={label}>
      <span className="photo-caption">{label}</span>
      {badge}
    </div>
  );
}
