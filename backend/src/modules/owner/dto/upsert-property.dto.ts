import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { EnergyRating, GuarantorRequirement } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Types de contrat qu'un propriétaire peut exiger, tels que proposés par la
 * maquette dans « Critères de sélection des candidats ».
 */
export enum AcceptedContract {
  CDI = 'CDI',
  CDD = 'CDD',
  PUBLIC_SECTOR = 'PUBLIC_SECTOR',
  SELF_EMPLOYED = 'SELF_EMPLOYED',
  STUDENT = 'STUDENT',
  RETIRED = 'RETIRED',
}

/**
 * Champs d'une annonce, tous facultatifs.
 *
 * Un dépôt d'annonce se remplit en plusieurs fois — la maquette le montre en
 * six étapes avec un brouillon enregistrable à tout moment. Exiger les champs
 * ici empêcherait d'enregistrer un travail en cours ; ce sont les contrôles de
 * publication qui refusent une annonce incomplète, pas la validation d'entrée.
 *
 * Les montants circulent en CENTIMES, comme partout dans le schéma.
 */
export class UpsertPropertyDto {
  @IsOptional() @Transform(trim) @IsString() @Length(3, 140)
  title?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(0, 8000)
  description?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(3, 200)
  addressLine?: string;

  /** Slug du quartier ; l'API vérifie qu'il existe dans le référentiel. */
  @IsOptional() @Transform(trim) @IsString()
  districtSlug?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  surfaceM2?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  rooms?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  bedrooms?: number;

  @IsOptional() @Transform(trim) @IsString() @Length(0, 20)
  floor?: string;

  @IsOptional() @Type(() => Boolean) @IsBoolean()
  furnished?: boolean;

  @IsOptional() @IsEnum(EnergyRating)
  energyRating?: EnergyRating;

  @IsOptional() @IsEnum(EnergyRating)
  gesRating?: EnergyRating;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1700) @Max(2100)
  constructionYear?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_00)
  rentCents?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_00)
  chargesCents?: number;

  /** ISO 8601. Vide ou absent = disponible immédiatement. */
  @IsOptional() @Transform(trim) @IsString()
  availableFrom?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_00)
  minMonthlyIncomeCents?: number;

  @IsOptional() @IsEnum(GuarantorRequirement)
  guarantorRequirement?: GuarantorRequirement;

  @IsOptional() @IsArray() @IsEnum(AcceptedContract, { each: true })
  acceptedContractTypes?: AcceptedContract[];
}
