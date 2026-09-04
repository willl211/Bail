import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Adresse postale du bailleur.
 *
 * Les trois champs sont **obligatoires ensemble** : une adresse amputée de son
 * code postal ou de sa commune ne désigne aucun domicile, et c'est un domicile
 * que la loi exige au bail (loi n° 89-462, article 3). Mieux vaut refuser la
 * saisie que porter une adresse incomplète sur un acte.
 */
export class UpdateOwnerProfileDto {
  @Transform(trim)
  @IsString()
  @Length(5, 200, { message: 'Indiquez le numéro et la voie.' })
  addressLine!: string;

  @Transform(trim)
  @IsString()
  // Cinq chiffres : la validation s'arrête là. Vérifier qu'un code postal
  // existe demanderait un référentiel à tenir à jour, et le refuser à tort
  // empêcherait quelqu'un de signer son bail.
  @Matches(/^\d{5}$/, { message: 'Le code postal se compose de cinq chiffres.' })
  postalCode!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 120, { message: 'Indiquez la commune.' })
  city!: string;
}
