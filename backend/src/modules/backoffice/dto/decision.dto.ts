import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Décision d'un agent sur une pièce ou un dossier. */
export class ReviewDecisionDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedRevision!: number;

  @IsIn(['VERIFY', 'REJECT'], { message: 'Décision inconnue.' })
  decision!: 'VERIFY' | 'REJECT';

  /**
   * Motif, obligatoire en cas de refus — le service le vérifie, parce qu'un
   * refus sans motif renvoie le locataire à un mur.
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(400)
  reason?: string;
}

/** Décision d'un agent sur une annonce. */
export class PropertyDecisionDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedRevision!: number;

  @IsIn(['PUBLISH', 'REJECT'], { message: 'Décision inconnue.' })
  decision!: 'PUBLISH' | 'REJECT';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(400)
  reason?: string;
}

export class DiagnosticDecisionDto extends ReviewDecisionDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issuedAt?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresAt?: string;

  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
  energyRating?: string;
}

export class AssignVisitDto {
  @IsUUID(undefined, { message: 'Agent invalide.' })
  agentId!: string;
}
