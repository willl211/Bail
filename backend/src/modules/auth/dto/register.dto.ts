import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Rôles ouverts à l'inscription publique.
 *
 * `AGENT` en est volontairement absent : un agent interne est créé depuis le
 * back-office, jamais par un formulaire public. Laisser le client choisir son
 * rôle sans filtrage donnerait un accès back-office à qui le demande.
 */
export enum RegistrableRole {
  OWNER = 'OWNER',
  TENANT = 'TENANT',
}

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email!: string;

  /**
   * 12 caractères minimum, comme annoncé sur le formulaire d'inscription de la
   * maquette. Pas de règle de composition imposée : la longueur protège mieux
   * qu'un assortiment de symboles, et les recommandations de l'ANSSI comme du
   * NIST vont dans ce sens.
   */
  @IsString()
  @MinLength(12, { message: 'Le mot de passe doit faire au moins 12 caractères.' })
  @MaxLength(200, { message: 'Le mot de passe est trop long.' })
  password!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80)
  lastName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 40)
  phone?: string;

  @IsEnum(RegistrableRole, { message: 'Rôle inconnu.' })
  role!: RegistrableRole;
}
