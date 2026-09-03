import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email!: string;

  /**
   * Aucune contrainte de longueur minimale ici : à la connexion, refuser un mot
   * de passe « trop court » avant même de le vérifier révélerait la politique
   * appliquée et distinguerait les erreurs. La borne haute existe seulement
   * pour éviter de faire hacher une charge arbitraire à bcrypt.
   */
  @IsString()
  @Length(1, 200)
  password!: string;
}
