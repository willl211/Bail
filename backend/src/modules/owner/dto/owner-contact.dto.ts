import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateOwnerContactDto {
  @Transform(trim)
  @IsString()
  @Length(1, 80, { message: 'Indiquez votre prénom.' })
  firstName!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80, { message: 'Indiquez votre nom.' })
  lastName!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s.()-]/g, '') : value,
  )
  @IsString()
  @Matches(/^(?:\+?[0-9]{7,15})?$/, {
    message: 'Indiquez un numéro de téléphone valide, avec son indicatif si nécessaire.',
  })
  phone!: string;
}
