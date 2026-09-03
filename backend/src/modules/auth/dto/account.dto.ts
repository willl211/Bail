import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Même exigence de longueur qu'à l'inscription, et pour la même raison : la
 * longueur protège mieux qu'un assortiment de symboles (ANSSI, NIST). Un
 * formulaire de réinitialisation plus permissif que celui d'inscription serait
 * une porte dérobée sur la politique de mot de passe.
 */
class NewPassword {
  @IsString()
  @MinLength(12, { message: 'Le mot de passe doit faire au moins 12 caractères.' })
  @MaxLength(200, { message: 'Le mot de passe est trop long.' })
  password!: string;
}

export class ForgotPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email!: string;
}

export class ResetPasswordDto extends NewPassword {
  @IsString()
  @MaxLength(200)
  token!: string;
}

export class ChangePasswordDto extends NewPassword {
  @IsString()
  @MaxLength(200)
  currentPassword!: string;
}

export class VerifyEmailDto {
  @IsString()
  @MaxLength(200)
  token!: string;
}
