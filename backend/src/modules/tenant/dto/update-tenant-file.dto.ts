import { EmploymentContractType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateTenantFileDto {
  @IsOptional()
  @IsEnum(EmploymentContractType, { message: 'Situation professionnelle inconnue.' })
  contractType?: EmploymentContractType;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  employerName?: string;

  /**
   * Revenus nets mensuels, en **centimes** comme tout montant du projet.
   *
   * La borne haute n'est pas une politique commerciale : elle évite qu'une
   * saisie en euros prise pour des centimes (ou l'inverse) produise un « loyer
   * accessible » absurde qui donnerait confiance à tort.
   */
  @IsOptional()
  @IsInt({ message: 'Les revenus doivent être un montant en centimes.' })
  @Min(0)
  @Max(100_000_00)
  netMonthlyIncomeCents?: number;

  @IsOptional()
  @IsBoolean()
  inProbationPeriod?: boolean;
}
