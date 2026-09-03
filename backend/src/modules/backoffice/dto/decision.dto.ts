import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Décision d'un agent sur une pièce ou un dossier. */
export class ReviewDecisionDto {
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
  @IsIn(['PUBLISH', 'REJECT'], { message: 'Décision inconnue.' })
  decision!: 'PUBLISH' | 'REJECT';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(400)
  reason?: string;
}

export class AssignVisitDto {
  @IsUUID(undefined, { message: 'Agent invalide.' })
  agentId!: string;
}
