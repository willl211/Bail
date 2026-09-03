import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Candidature envoyée par le locataire.
 *
 * Pas de champ `consent` : transmettre la synthèse vérifiée au propriétaire
 * **est** l'objet du service, pas un traitement accessoire auquel on
 * consentirait. Le fondement est l'exécution du contrat, et le locataire en
 * est informé sur l'écran avant d'envoyer (docs/legal-context.md). Une case à
 * cocher pré-remplie aurait donné l'apparence d'un consentement sans en avoir
 * la valeur — le RGPD exige un acte positif.
 */
export class CreateApplicationDto {
  /** Mot libre au propriétaire, facultatif. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(600)
  message?: string;
}
