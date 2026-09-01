import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Tri des résultats de recherche.
 *
 * `COMPATIBILITY` correspond au « TRI : COMPATIBILITÉ » de la maquette. Tant
 * que la recherche est consultable sans compte (écran 1 du build-order), il
 * n'existe pas de dossier locataire à confronter aux critères : le tri retombe
 * alors sur les annonces les plus récemment publiées.
 */
export enum PropertySort {
  COMPATIBILITY = 'compatibility',
  RENT_ASC = 'rent_asc',
  RENT_DESC = 'rent_desc',
  SURFACE_DESC = 'surface_desc',
  RECENT = 'recent',
}

export enum FurnishedFilter {
  ALL = 'all',
  FURNISHED = 'furnished',
  UNFURNISHED = 'unfurnished',
}

/** Transforme `?districts=sablon,centre-ville` ou `?districts=a&districts=b`. */
const toStringArray = ({ value }: { value: unknown }): string[] => {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return raw.map((entry) => String(entry).trim()).filter(Boolean);
};

export class SearchPropertiesDto {
  /** Loyer maximum charges comprises, en euros (curseur 400 → 1 600 côté UI). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  maxRent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minRent?: number;

  /** Surface minimum en m² (0 / 30 / 50 / 80 côté UI). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  minSurface?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  minRooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxRooms?: number;

  @IsOptional()
  @IsEnum(FurnishedFilter)
  furnished?: FurnishedFilter = FurnishedFilter.ALL;

  /** Slugs de quartiers. Vide = tous les quartiers. */
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  districts?: string[] = [];

  @IsOptional()
  @IsEnum(PropertySort)
  sort?: PropertySort = PropertySort.COMPATIBILITY;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize?: number = 20;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  availableOnly?: boolean;
}
