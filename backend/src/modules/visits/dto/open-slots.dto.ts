import { VisitType } from '@prisma/client';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEnum, IsISO8601 } from 'class-validator';

export class OpenSlotsDto {
  /**
   * Horaires de début, en ISO 8601.
   *
   * Un tableau plutôt qu'une date unique : un propriétaire ouvre une plage de
   * disponibilités, rarement un rendez-vous isolé. La borne haute évite qu'une
   * requête ouvre un semestre d'un coup.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'Indiquez au moins un créneau.' })
  @ArrayMaxSize(60, { message: 'Pas plus de 60 créneaux d’un coup.' })
  @IsISO8601({ strict: true }, { each: true, message: 'Horaire de créneau illisible.' })
  startsAt!: string[];

  /** Types de visite acceptés sur ces créneaux. */
  @IsArray()
  @ArrayNotEmpty({ message: 'Choisissez au moins un type de visite.' })
  @IsEnum(VisitType, { each: true, message: 'Type de visite inconnu.' })
  allowedTypes!: VisitType[];
}
