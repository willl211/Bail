import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RejectApplicationDto {
  /**
   * Motif du refus, facultatif mais transmis au candidat.
   *
   * Un dossier écarté sans un mot est ce que le marché fait déjà de pire ; le
   * champ existe pour que Bail puisse faire autrement.
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  reason?: string;
}
