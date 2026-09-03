import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PropertyStatus, VisitStatus, VisitType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenSlotsDto } from './dto/open-slots.dto';
import { VISIT_DURATION_MINUTES, overlaps } from './visit.policy';

/** Créneau tel que son propriétaire le voit. */
export interface OwnerSlotView {
  id: string;
  startsAt: string;
  durationMinutes: number;
  allowedTypes: VisitType[];
  /** Occupé par une visite réservée ? */
  booked: boolean;
  /** Locataire qui l'a réservé, `null` si libre. */
  bookedBy: string | null;
  visitStatus: VisitStatus | null;
  /** Passé : ni annulable, ni réservable. */
  past: boolean;
}

/** Au-delà, ouvrir des créneaux relève du remplissage, pas de la planification. */
const MAX_OPEN_SLOTS = 60;

/** Un créneau ouvert à plus de trois mois n'a aucune chance d'être tenu. */
const MAX_HORIZON_DAYS = 90;

@Injectable()
export class SlotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bien du propriétaire connecté.
   *
   * 404 et non 403 sur le bien d'un autre : « interdit » confirmerait que la
   * référence existe.
   */
  private async ownedOrFail(ownerId: string, reference: string) {
    const property = await this.prisma.property.findFirst({
      where: { reference, ownerId },
      select: { id: true, reference: true, status: true },
    });
    if (!property) throw new NotFoundException('Bien introuvable.');
    return property;
  }

  async list(ownerId: string, reference: string): Promise<OwnerSlotView[]> {
    const property = await this.ownedOrFail(ownerId, reference);
    return this.listForProperty(property.id);
  }

  private async listForProperty(propertyId: string): Promise<OwnerSlotView[]> {
    const slots = await this.prisma.visitSlot.findMany({
      where: { propertyId, closedAt: null },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        allowedTypes: true,
        visit: {
          select: {
            status: true,
            tenant: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    const now = Date.now();
    return slots.map((slot) => ({
      id: slot.id,
      startsAt: slot.startsAt.toISOString(),
      durationMinutes: slot.durationMinutes,
      allowedTypes: slot.allowedTypes,
      booked: slot.visit !== null,
      bookedBy: slot.visit
        ? `${slot.visit.tenant.firstName} ${slot.visit.tenant.lastName}`
        : null,
      visitStatus: slot.visit?.status ?? null,
      past: slot.startsAt.getTime() < now,
    }));
  }

  /**
   * Ouvre des créneaux sur un bien.
   *
   * Plusieurs d'un coup : un propriétaire ouvre une plage de disponibilités,
   * pas un rendez-vous isolé. Les doublons et les chevauchements sont écartés
   * en silence plutôt que de faire échouer tout le lot — rouvrir une semaine
   * déjà partiellement ouverte est un geste normal.
   */
  async open(
    ownerId: string,
    reference: string,
    dto: OpenSlotsDto,
  ): Promise<OwnerSlotView[]> {
    const property = await this.ownedOrFail(ownerId, reference);

    if (property.status === PropertyStatus.DRAFT) {
      throw new ConflictException(
        'Publiez d’abord ce bien : un brouillon ne reçoit pas de visite.',
      );
    }

    const horizon = Date.now() + MAX_HORIZON_DAYS * 24 * 3600 * 1000;
    const requested = dto.startsAt.map((iso) => {
      const startsAt = new Date(iso);
      if (Number.isNaN(startsAt.getTime())) {
        throw new BadRequestException(`Horaire illisible : ${iso}`);
      }
      if (startsAt.getTime() < Date.now()) {
        throw new BadRequestException('Un créneau ne peut pas être ouvert dans le passé.');
      }
      if (startsAt.getTime() > horizon) {
        throw new BadRequestException(
          `Un créneau ne peut pas être ouvert à plus de ${MAX_HORIZON_DAYS} jours.`,
        );
      }
      return startsAt;
    });

    // La durée retenue est la plus longue des types autorisés : un créneau
    // ouvert aux deux doit pouvoir accueillir une visite accompagnée.
    const durationMinutes = Math.max(
      ...dto.allowedTypes.map((type) => VISIT_DURATION_MINUTES[type]),
    );

    const existing = await this.prisma.visitSlot.findMany({
      where: { propertyId: property.id, closedAt: null },
      select: { startsAt: true, durationMinutes: true },
    });

    const kept: Date[] = [];
    for (const startsAt of requested.sort((a, b) => a.getTime() - b.getTime())) {
      const candidate = { startsAt, durationMinutes };
      const clashes =
        existing.some((slot) => overlaps(slot, candidate)) ||
        kept.some((other) => overlaps({ startsAt: other, durationMinutes }, candidate));
      if (!clashes) {
        kept.push(startsAt);
        existing.push(candidate);
      }
    }

    if (kept.length === 0) {
      throw new ConflictException(
        'Ces horaires chevauchent des créneaux déjà ouverts sur ce bien.',
      );
    }
    if (kept.length > MAX_OPEN_SLOTS) {
      throw new BadRequestException(
        `Pas plus de ${MAX_OPEN_SLOTS} créneaux ouverts d’un coup.`,
      );
    }

    await this.prisma.visitSlot.createMany({
      data: kept.map((startsAt) => ({
        propertyId: property.id,
        openedById: ownerId,
        startsAt,
        durationMinutes,
        allowedTypes: dto.allowedTypes,
      })),
      // Filet contre la contrainte `@@unique([propertyId, startsAt])` : un
      // créneau fermé puis rouvert au même horaire existe encore en base.
      skipDuplicates: true,
    });

    return this.listForProperty(property.id);
  }

  /**
   * Retire un créneau.
   *
   * Un créneau réservé ne se retire pas : c'est un rendez-vous pris avec
   * quelqu'un. Il faut annuler la visite, ce qui prévient le locataire.
   */
  async close(
    ownerId: string,
    reference: string,
    slotId: string,
  ): Promise<OwnerSlotView[]> {
    const property = await this.ownedOrFail(ownerId, reference);

    const slot = await this.prisma.visitSlot.findFirst({
      where: { id: slotId, propertyId: property.id, closedAt: null },
      select: { id: true, visitId: true },
    });
    if (!slot) throw new NotFoundException('Créneau introuvable.');

    if (slot.visitId !== null) {
      throw new ConflictException(
        'Ce créneau est réservé. Annulez la visite pour le libérer — le locataire en sera informé.',
      );
    }

    await this.prisma.visitSlot.update({
      where: { id: slot.id },
      data: { closedAt: new Date() },
    });

    return this.listForProperty(property.id);
  }
}
