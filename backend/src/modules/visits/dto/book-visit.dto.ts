import { VisitType } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class BookVisitDto {
  @IsUUID(undefined, { message: 'Créneau invalide.' })
  slotId!: string;

  @IsEnum(VisitType, { message: 'Type de visite inconnu.' })
  type!: VisitType;
}
