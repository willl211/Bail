import { EmploymentContractType, GuarantorKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Garant du dossier.
 *
 * Les champs sont tous facultatifs ici parce que leur obligation dépend du
 * type : une personne physique a un nom, un organisme de cautionnement a une
 * raison sociale. La règle croisée est vérifiée dans le service, où les deux
 * valeurs sont connues en même temps.
 */
export class UpsertGuarantorDto {
  @IsEnum(GuarantorKind, { message: 'Type de garant inconnu.' })
  kind!: GuarantorKind;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  organisationName?: string;

  /** Lien avec le locataire : « mère », « employeur », « ami ». */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  relationship?: string;

  @IsOptional()
  @IsInt({ message: 'Les revenus du garant doivent être un montant en centimes.' })
  @Min(0)
  @Max(100_000_00)
  netMonthlyIncomeCents?: number;

  @IsOptional()
  @IsEnum(EmploymentContractType, { message: 'Situation du garant inconnue.' })
  contractType?: EmploymentContractType;
}
