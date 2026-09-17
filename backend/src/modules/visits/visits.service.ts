import { visiblePropertyWhere } from '../properties/property-visibility';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  PaymentStatus,
  PaymentType,
  Prisma,
  PreauthorizationStatus,
  VisitStatus,
  VisitType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT } from '../mail/event.templates';
import { MailService } from '../mail/mail.service';
import { PAYMENT_DRIVER, type PaymentDriver } from '../payments/payment.driver';
import { TenantService } from '../tenant/tenant.service';
import { aggregateDocumentStatus } from '../tenant/tenant-file.policy';
import { VIDEO_DRIVER, type VideoDriver } from '../video/video.driver';
import { BookVisitDto } from './dto/book-visit.dto';
import {
  LIVE_VISIT,
  overlaps,
  DEFAULT_VISIT_POLICY,
  VISIT_DURATION_MINUTES,
  VISIT_SETTING_KEYS,
  type VisitPolicy,
} from './visit.policy';

/** Candidatures qui ouvrent droit à une visite. */
const VISITABLE: ApplicationStatus[] = [
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.VISIT_SCHEDULED,
];

export interface BookableSlot {
  id: string;
  startsAt: string;
  durationMinutes: number;
  allowedTypes: VisitType[];
}

export interface VisitView {
  id: string;
  propertyReference: string;
  propertyTitle: string;
  addressLine: string;
  district: string;
  type: VisitType;
  status: VisitStatus;
  scheduledAt: string;
  durationMinutes: number;
  agentName: string | null;
  videoRoomUrl: string | null;
  preauthorizationStatus: PreauthorizationStatus;
  preauthorizationAmountCents: number | null;
  /** L'annulation est-elle encore possible ? */
  cancellable: boolean;
}

/** Contrôle préalable au rendez-vous, tel qu'affiché avant de réserver. */
export interface VisitPrerequisite {
  key: 'identity' | 'preauthorization' | 'camera';
  label: string;
  detail: string;
  state: 'ok' | 'pending' | 'info';
  /** Empêche la réservation tant qu'il n'est pas satisfait. */
  blocking: boolean;
}

export interface VisitBookingView {
  property: {
    reference: string;
    title: string;
    addressLine: string;
    district: string;
  };
  /** `null` si le locataire n'a pas de candidature retenue sur ce bien. */
  applicationStatus: ApplicationStatus | null;
  /** Ce qui empêche de réserver. Vide = on peut choisir un créneau. */
  blockers: string[];
  prerequisites: VisitPrerequisite[];
  slots: BookableSlot[];
  /** Visite déjà réservée sur ce bien, le cas échéant. */
  visit: VisitView | null;
  durations: Record<VisitType, number>;
  cancellationDeadlineHours: number;
  recordingRetentionDays: number;
  /** Drivers actifs — `mock` tant qu'aucun prestataire n'est branché. */
  drivers: { video: string; payment: string };
}

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    @Inject(VIDEO_DRIVER) private readonly video: VideoDriver,
    @Inject(PAYMENT_DRIVER) private readonly payment: PaymentDriver,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------- Réglages

  /**
   * Réglages de visite, lus en base.
   *
   * Aucune de ces valeurs n'est codée en dur : montant de l'empreinte, délai
   * d'annulation et rétention des enregistrements doivent pouvoir bouger sans
   * redéploiement (README, règle 3). Les valeurs de repli servent uniquement
   * si le réglage n'a jamais été seedé.
   */
  private async policy(): Promise<VisitPolicy> {
    const settings = await this.prisma.platformSetting.findMany({
      where: { key: { in: Object.values(VISIT_SETTING_KEYS) } },
    });

    const read = (key: string, fallback: number): number => {
      const value = settings.find((setting) => setting.key === key)?.value;
      const parsed = typeof value === 'string' ? Number(value) : value;
      return typeof parsed === 'number' &&
        Number.isSafeInteger(parsed) &&
        parsed >= 0 &&
        parsed <= 36500
        ? parsed
        : fallback;
    };

    return {
      preauthorizationAmountCents: read(
        VISIT_SETTING_KEYS.preauthorizationAmountCents,
        DEFAULT_VISIT_POLICY.preauthorizationAmountCents,
      ),
      cancellationDeadlineHours: read(
        VISIT_SETTING_KEYS.cancellationDeadlineHours,
        DEFAULT_VISIT_POLICY.cancellationDeadlineHours,
      ),
      recordingRetentionDays: read(
        VISIT_SETTING_KEYS.recordingRetentionDays,
        DEFAULT_VISIT_POLICY.recordingRetentionDays,
      ),
    };
  }

  /**
   * L'empreinte bancaire est-elle exigible ?
   *
   * Non tant qu'aucun prestataire de paiement n'est branché : demander une
   * empreinte sans pouvoir la prendre bloquerait tout rendez-vous, et
   * l'inscrire « autorisée » sans carte serait un mensonge. L'écran dit
   * laquelle des deux situations s'applique.
   */
  private preauthorizationRequired(): boolean {
    return this.payment.name !== 'mock';
  }

  // ---------------------------------------------------------------- Lecture

  private async visitableProperty(reference: string) {
    const property = await this.prisma.property.findFirst({
      where: {
        reference,
        ...visiblePropertyWhere(),
      },
      select: {
        id: true,
        ownerId: true,
        reference: true,
        title: true,
        addressLine: true,
        district: { select: { name: true } },
      },
    });
    if (!property) throw new NotFoundException('Ce bien n’est plus visitable.');
    return property;
  }

  private static toVisitView(
    visit: Prisma.VisitGetPayload<{
      include: {
        property: { select: { reference: true; title: true; addressLine: true; district: true } };
        agent: { select: { firstName: true; lastName: true } };
      };
    }>,
    cancellationDeadlineHours: number,
  ): VisitView {
    const deadline = visit.scheduledAt.getTime() - cancellationDeadlineHours * 3600 * 1000;

    return {
      id: visit.id,
      propertyReference: visit.property.reference,
      propertyTitle: visit.property.title,
      addressLine: visit.property.addressLine,
      district: visit.property.district.name,
      type: visit.type,
      status: visit.status,
      scheduledAt: visit.scheduledAt.toISOString(),
      durationMinutes: visit.durationMinutes,
      agentName: visit.agent ? `${visit.agent.firstName} ${visit.agent.lastName.charAt(0)}.` : null,
      // Aucun lien permanent ou simulé exposé aux listes.
      videoRoomUrl: null,
      preauthorizationStatus: visit.preauthorizationStatus,
      preauthorizationAmountCents: visit.preauthorizationAmountCents,
      cancellable: LIVE_VISIT.includes(visit.status) && Date.now() < deadline,
    };
  }

  private static readonly VISIT_INCLUDE = {
    property: { select: { reference: true, title: true, addressLine: true, district: true } },
    agent: { select: { firstName: true, lastName: true } },
  } satisfies Prisma.VisitInclude;

  /** Écran de prise de rendez-vous pour un bien. */
  async bookingView(tenantId: string, reference: string): Promise<VisitBookingView> {
    const [property, policy, file] = await Promise.all([
      this.visitableProperty(reference),
      this.policy(),
      this.tenant.getFile(tenantId),
    ]);

    const [application, existing, slots] = await Promise.all([
      this.prisma.application.findFirst({
        where: { tenantId, propertyId: property.id },
        select: { status: true },
      }),
      this.prisma.visit.findFirst({
        where: { tenantId, propertyId: property.id, status: { in: LIVE_VISIT } },
        include: VisitsService.VISIT_INCLUDE,
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.visitSlot.findMany({
        where: {
          propertyId: property.id,
          closedAt: null,
          visitId: null,
          startsAt: { gt: new Date() },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          allowedTypes: true,
        },
      }),
    ]);

    const identityVerified = file.groups.identity === 'VERIFIED';
    const blockers: string[] = [];

    if (application === null) {
      blockers.push('Candidatez d’abord sur ce bien.');
    } else if (!VISITABLE.includes(application.status)) {
      blockers.push(
        application.status === ApplicationStatus.SUBMITTED ||
          application.status === ApplicationStatus.READ
          ? 'Le propriétaire n’a pas encore retenu votre candidature.'
          : 'Votre candidature n’ouvre pas droit à une visite.',
      );
    }

    // Contrôle d'identité avant tout rendez-vous : c'est une personne qu'on
    // envoie ouvrir un logement à un inconnu (docs/integrations.md).
    if (!identityVerified) {
      blockers.push('Votre pièce d’identité doit être vérifiée avant tout rendez-vous.');
    }

    const bookableSlots = slots
      .map((slot) => ({
        ...slot,
        allowedTypes: slot.allowedTypes.filter(
          (type) => type !== VisitType.VIDEO || this.video.name !== 'mock',
        ),
      }))
      .filter((slot) => slot.allowedTypes.length > 0);
    if (this.preauthorizationRequired() && existing === null) {
      blockers.push(
        'La réservation avec empreinte bancaire attend encore son activation. Contactez whoma.',
      );
    }
    if (bookableSlots.length === 0 && existing === null) {
      blockers.push('Aucun créneau n’est ouvert sur ce bien pour l’instant.');
    }

    return {
      property: {
        reference: property.reference,
        title: property.title,
        addressLine: property.addressLine,
        district: property.district.name,
      },
      applicationStatus: application?.status ?? null,
      blockers,
      prerequisites: this.prerequisitesOf(identityVerified, policy, existing),
      slots: bookableSlots.map((slot) => ({
        id: slot.id,
        startsAt: slot.startsAt.toISOString(),
        durationMinutes: slot.durationMinutes,
        allowedTypes: slot.allowedTypes,
      })),
      visit: existing
        ? VisitsService.toVisitView(existing, policy.cancellationDeadlineHours)
        : null,
      durations: VISIT_DURATION_MINUTES,
      cancellationDeadlineHours: policy.cancellationDeadlineHours,
      recordingRetentionDays: policy.recordingRetentionDays,
      drivers: { video: this.video.name, payment: this.payment.name },
    };
  }

  /** Les trois contrôles annoncés par la maquette avant le rendez-vous. */
  private prerequisitesOf(
    identityVerified: boolean,
    policy: VisitPolicy,
    visit: { preauthorizationStatus: PreauthorizationStatus } | null,
  ): VisitPrerequisite[] {
    const required = this.preauthorizationRequired();
    const euros = (policy.preauthorizationAmountCents / 100).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return [
      {
        key: 'identity',
        label: 'Vérification d’identité',
        detail: identityVerified
          ? 'Validée avec votre dossier'
          : 'Déposez une pièce d’identité dans votre dossier',
        state: identityVerified ? 'ok' : 'pending',
        blocking: true,
      },
      {
        key: 'preauthorization',
        label: 'Pré-autorisation bancaire',
        detail: required
          ? `Empreinte de ${euros} €, aucun débit. Libérée après la visite.`
          : `Empreinte de ${euros} € prévue, non demandée : aucun prestataire de paiement n’est branché.`,
        state: !required
          ? 'info'
          : visit?.preauthorizationStatus === PreauthorizationStatus.AUTHORIZED
            ? 'ok'
            : 'pending',
        blocking: required,
      },
      {
        key: 'camera',
        label: 'Caméra active pendant la visio',
        detail:
          this.video.name === 'mock'
            ? 'Les visites en visio ne sont pas encore disponibles.'
            : `Le protocole de la visio doit être validé avant activation. Rétention prévue : ${policy.recordingRetentionDays} jours.`,
        state: 'info',
        blocking: false,
      },
    ];
  }

  async listMine(tenantId: string): Promise<VisitView[]> {
    const [policy, visits] = await Promise.all([
      this.policy(),
      this.prisma.visit.findMany({
        where: { tenantId },
        include: VisitsService.VISIT_INCLUDE,
        orderBy: { scheduledAt: 'desc' },
      }),
    ]);

    return visits.map((visit) =>
      VisitsService.toVisitView(visit, policy.cancellationDeadlineHours),
    );
  }

  // --------------------------------------------------------------- Écriture

  /**
   * Réserve un créneau.
   *
   * La prise du créneau se fait dans une transaction : deux locataires qui
   * cliquent en même temps sur le même horaire ne doivent pas repartir tous
   * deux avec un rendez-vous. C'est la contrainte d'unicité sur `visitId` qui
   * tranche, pas une vérification préalable qui aurait le temps de mentir.
   */
  async book(tenantId: string, reference: string, dto: BookVisitDto): Promise<VisitBookingView> {
    if (dto.type === VisitType.VIDEO && this.video.name === 'mock') {
      throw new ServiceUnavailableException(
        'Les visites en visio ne sont pas encore disponibles. Choisissez une visite accompagnée.',
      );
    }
    if (this.preauthorizationRequired()) {
      throw new ServiceUnavailableException(
        'La réservation avec empreinte bancaire attend encore son activation. Contactez whoma.',
      );
    }
    const property = await this.visitableProperty(reference);
    const [policy, file] = await Promise.all([this.policy(), this.tenant.getFile(tenantId)]);

    if (file.groups.identity !== 'VERIFIED') {
      throw new BadRequestException(
        'Votre pièce d’identité doit être vérifiée avant tout rendez-vous.',
      );
    }
    const durationMinutes = VISIT_DURATION_MINUTES[dto.type];
    const preauthorizationRequired = this.preauthorizationRequired();
    const { visitId, startsAt } = await this.prisma.$transaction(async (tx) => {
      // Sérialiser aussi deux créneaux différents du même locataire, puis les
      // changements du calendrier du bien (ouverture, fermeture, réservation).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(621, hashtext(${tenantId}))`;
      await tx.$executeRaw`SELECT "id" FROM "properties" WHERE "id" = ${property.id} FOR UPDATE`;
      await tx.$executeRaw`SELECT "id" FROM "tenant_files" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
      const identity = await tx.tenantDocument.findMany({
        where: {
          tenantFile: { tenantId },
          type: { in: ['ID_CARD', 'PASSPORT'] },
        },
        select: { status: true },
      });
      if (aggregateDocumentStatus(identity) !== 'VERIFIED') {
        throw new ConflictException('Votre identité doit être vérifiée avant de réserver.');
      }
      const visible = await tx.property.findFirst({
        where: { id: property.id, ...visiblePropertyWhere() },
      });
      if (!visible) throw new ConflictException('Ce bien n’est plus visitable.');
      const application = await tx.application.findFirst({
        where: { tenantId, propertyId: property.id },
      });
      if (!application || !VISITABLE.includes(application.status)) {
        throw new ConflictException(
          'Votre candidature ne vous ouvre pas de rendez-vous sur ce bien.',
        );
      }
      // Une décision propriétaire concurrente ne doit jamais être écrasée.
      const eligible = await tx.application.updateMany({
        where: { id: application.id, status: { in: VISITABLE } },
        data: { status: ApplicationStatus.VISIT_SCHEDULED },
      });
      if (!eligible.count)
        throw new ConflictException('Votre candidature a changé. Rechargez la page.');
      const active = await tx.visit.findMany({ where: { tenantId, status: { in: LIVE_VISIT } } });
      if (active.some((v) => v.propertyId === property.id)) {
        throw new ConflictException(
          'Vous avez déjà un rendez-vous sur ce bien. Annulez-le pour en choisir un autre.',
        );
      }
      const slot = await tx.visitSlot.findFirst({
        where: { id: dto.slotId, propertyId: property.id, closedAt: null },
      });
      if (!slot) throw new NotFoundException('Créneau introuvable.');
      if (slot.visitId || slot.startsAt.getTime() <= Date.now())
        throw new ConflictException('Ce créneau n’est plus disponible.');
      if (!slot.allowedTypes.includes(dto.type) || slot.durationMinutes < durationMinutes) {
        throw new BadRequestException('Ce créneau n’accepte pas ce type de visite.');
      }
      if (
        active.some((v) =>
          overlaps(
            { startsAt: v.scheduledAt, durationMinutes: v.durationMinutes },
            { startsAt: slot.startsAt, durationMinutes },
          ),
        )
      ) {
        throw new ConflictException('Vous avez déjà une visite à cet horaire.');
      }
      const created = await tx.visit.create({
        data: {
          propertyId: property.id,
          tenantId,
          applicationId: application.id,
          type: dto.type,
          status: preauthorizationRequired ? VisitStatus.PENDING_CHECKS : VisitStatus.CONFIRMED,
          scheduledAt: slot.startsAt,
          durationMinutes,
          preauthorizationStatus: preauthorizationRequired
            ? PreauthorizationStatus.PENDING
            : PreauthorizationStatus.NOT_REQUIRED,
          preauthorizationAmountCents: preauthorizationRequired
            ? policy.preauthorizationAmountCents
            : null,
        },
      });
      const taken = await tx.visitSlot.updateMany({
        where: { id: slot.id, visitId: null, closedAt: null, startsAt: { gt: new Date() } },
        data: { visitId: created.id },
      });
      if (!taken.count) throw new ConflictException('Ce créneau vient d’être réservé ou fermé.');
      for (const userId of [property.ownerId, tenantId]) {
        await this.mail.enqueueInTransaction(tx, {
          template: EVENT.visitBooked,
          userId,
          subjectRef: created.id,
          dedupeKey: `visit-booked:${created.id}:${userId}`,
        });
      }
      return { visitId: created.id, startsAt: slot.startsAt };
    });

    if (dto.type === VisitType.VIDEO) {
      await this.openVideoRoom(visitId, startsAt, durationMinutes, policy);
    }
    if (preauthorizationRequired) {
      await this.openPreauthorization(visitId, tenantId, property.id, policy);
    }

    return this.bookingView(tenantId, reference);
  }

  /**
   * Ouvre la salle de visio.
   *
   * Hors transaction : un appel au prestataire n'a rien à faire dans une
   * transaction de base, il la tiendrait ouverte le temps du réseau. Si la
   * salle échoue, le rendez-vous existe quand même — c'est le lien qui manque,
   * et il se recrée ; l'inverse laisserait une salle orpheline chez le
   * prestataire.
   */
  private async openVideoRoom(
    visitId: string,
    startsAt: Date,
    durationMinutes: number,
    policy: VisitPolicy,
  ): Promise<void> {
    const recordingExpiresAt = new Date(
      startsAt.getTime() + policy.recordingRetentionDays * 24 * 3600 * 1000,
    );

    try {
      const room = await this.video.createRoom({
        visitId,
        startsAt,
        durationMinutes,
        recordingExpiresAt,
      });

      await this.prisma.visit.update({
        where: { id: visitId },
        data: {
          videoProvider: this.video.name,
          videoRoomId: room.id,
          videoRoomUrl: room.url,
          // Posée dès l'ouverture : la date de purge ne doit pas dépendre d'un
          // traitement ultérieur qui pourrait ne jamais tourner.
          recordingExpiresAt,
        },
      });
    } catch (error) {
      this.logger.error(
        `Salle de visio impossible à ouvrir pour la visite ${visitId} : ${(error as Error).message}`,
      );
    }
  }

  /** Prend l'empreinte bancaire préalable au rendez-vous. */
  private async openPreauthorization(
    visitId: string,
    tenantId: string,
    propertyId: string,
    policy: VisitPolicy,
  ): Promise<void> {
    try {
      const intent = await this.payment.createPaymentIntent({
        captureMethod: 'manual',
        amountCents: policy.preauthorizationAmountCents,
        currency: 'EUR',
        description: 'whoma — pré-autorisation avant visite',
        metadata: { visitId },
      });

      await this.prisma.$transaction([
        this.prisma.visit.update({
          where: { id: visitId },
          data: { preauthorizationReference: intent.id },
        }),
        this.prisma.payment.create({
          data: {
            reference: `PRE-${visitId.slice(0, 8).toUpperCase()}`,
            type: PaymentType.VISIT_PREAUTHORIZATION,
            status: PaymentStatus.PENDING,
            payerId: tenantId,
            propertyId,
            amountCents: policy.preauthorizationAmountCents,
            tenantShareCents: policy.preauthorizationAmountCents,
            stripePaymentIntentId: intent.id,
          },
        }),
      ]);
    } catch (error) {
      this.logger.error(
        `Pré-autorisation impossible pour la visite ${visitId} : ${(error as Error).message}`,
      );
      await this.prisma.visit.update({
        where: { id: visitId },
        data: { preauthorizationStatus: PreauthorizationStatus.FAILED },
      });
    }
  }

  /**
   * Annule un rendez-vous.
   *
   * Le créneau redevient libre : il a été ouvert par le propriétaire, il lui
   * revient dès que personne ne l'occupe.
   */
  async cancel(tenantId: string, visitId: string, reason?: string): Promise<VisitView[]> {
    const policy = await this.policy();

    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, tenantId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        videoRoomId: true,
        applicationId: true,
        propertyId: true,
        agentId: true,
        property: { select: { ownerId: true } },
      },
    });
    // 404 et non 403 : « interdit » confirmerait que la visite existe ailleurs.
    if (!visit) throw new NotFoundException('Rendez-vous introuvable.');

    if (visit.status === VisitStatus.CANCELLED) return this.listMine(tenantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(621, hashtext(${tenantId}))`;
      await tx.$executeRaw`SELECT "id" FROM "properties" WHERE "id" = ${visit.propertyId} FOR UPDATE`;
      const before = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
      if (before.status === VisitStatus.CANCELLED) return;
      if (visit.applicationId) {
        await tx.application.updateMany({
          where: { id: visit.applicationId, status: ApplicationStatus.VISIT_SCHEDULED },
          data: { status: ApplicationStatus.SHORTLISTED },
        });
      }
      const changed = await tx.visit.updateMany({
        where: {
          id: visitId,
          status: {
            in: [VisitStatus.REQUESTED, VisitStatus.PENDING_CHECKS, VisitStatus.CONFIRMED],
          },
          scheduledAt: { gt: new Date(Date.now() + policy.cancellationDeadlineHours * 3600_000) },
        },
        data: {
          status: VisitStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: reason ?? null,
          videoRoomUrl: null,
        },
      });
      if (!changed.count) {
        const current = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
        if (current.status === VisitStatus.CANCELLED) return;
        throw new ConflictException(
          `Ce rendez-vous n’est plus annulable en ligne (délai : ${policy.cancellationDeadlineHours} heures). Contactez whoma.`,
        );
      }
      await tx.visitSlot.updateMany({ where: { visitId }, data: { visitId: null } });
      const current = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
      for (const userId of new Set(
        [tenantId, visit.property.ownerId, current.agentId].filter((id): id is string => !!id),
      )) {
        await this.mail.enqueueInTransaction(tx, {
          template: EVENT.visitCancelled,
          userId,
          subjectRef: visitId,
          dedupeKey: `visit-cancelled:${visitId}:${userId}`,
        });
      }
      // La purge ferme les salles annulées et reprend les échecs. Une annulation
      // ne signifie pas que l’empreinte bancaire a été libérée chez Stripe.
    });

    return this.listMine(tenantId);
  }
}
