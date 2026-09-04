import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApplicationStatus,
  DocumentType,
  LeaseStatus,
  PaymentStatus,
  PropertyStatus,
  VisitStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ATTRIBUTION_REASON, ATTRIBUTION_VISIT_REASON } from '../applications/attribution';
import { SIGNATURE_VALIDITY_DAYS } from '../lease/signature.validity';
import * as tpl from './event.templates';
import { EVENT } from './event.templates';
import type { RenderedTemplate } from './mail.templates';

/** Le bail attend encore une ou deux signatures. */
const AWAITING_SIGNATURE: LeaseStatus[] = [
  LeaseStatus.SENT_FOR_SIGNATURE,
  LeaseStatus.PARTIALLY_SIGNED,
];

/** Statuts pour lesquels une annonce est encore visible et candidatable. */
const VISIBLE: PropertyStatus[] = [
  PropertyStatus.ONLINE,
  PropertyStatus.VISITS_IN_PROGRESS,
];

/** Libellés des pièces, tels qu'affichés au locataire. */
const DOCUMENT_LABELS: Partial<Record<DocumentType, string>> = {
  ID_CARD: 'Pièce d’identité',
  PASSPORT: 'Passeport',
  PAYSLIP: 'Bulletin de salaire',
  EMPLOYMENT_CONTRACT: 'Contrat de travail',
  TAX_NOTICE: 'Avis d’imposition',
  PROOF_OF_ADDRESS: 'Justificatif de domicile',
  STUDENT_CARD: 'Certificat de scolarité',
  GUARANTOR_ID: 'Pièce d’identité du garant',
  GUARANTOR_INCOME: 'Revenus du garant',
  OTHER: 'Pièce',
};

export interface ResolvedEvent {
  to: string;
  message: RenderedTemplate;
}

/**
 * Reconstruit le contenu d'une notification au moment de l'envoi.
 *
 * La file ne stocke qu'un gabarit, un destinataire et l'identifiant de l'objet
 * concerné : tout le reste est relu ici, dans la base. Deux conséquences
 * voulues. Rien n'est recopié — le journal des envois ne devient pas un double
 * des données du produit. Et un message parti avec dix minutes de retard dit ce
 * qui est vrai à l'envoi, pas ce qui l'était à la mise en file.
 *
 * `null` signifie « il n'y a plus lieu d'envoyer » : l'objet a disparu, ou la
 * situation a changé au point que le message n'aurait plus de sens. Le message
 * est alors abandonné, pas réessayé.
 */
@Injectable()
export class EventResolver {
  private readonly logger = new Logger(EventResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get site(): string {
    return this.config.get<string>('siteUrl', 'http://localhost:3000');
  }

  async resolve(
    template: string,
    subjectRef: string | null,
    recipientId: string | null,
  ): Promise<ResolvedEvent | null> {
    if (!subjectRef) return null;

    const recipient = recipientId
      ? await this.prisma.user.findUnique({
          where: { id: recipientId },
          select: { email: true, firstName: true, isActive: true },
        })
      : null;
    // Un compte désactivé ne reçoit plus rien : la notification n'a pas à
    // survivre à la fermeture du compte qu'elle concerne.
    if (!recipient || !recipient.isActive) return null;

    const message = await this.render(
      template,
      subjectRef,
      recipient.firstName,
      recipientId,
    );
    return message ? { to: recipient.email, message } : null;
  }

  private async render(
    template: string,
    ref: string,
    firstName: string,
    recipientId: string | null,
  ): Promise<RenderedTemplate | null> {
    switch (template) {
      case EVENT.savedPropertyPriceDrop:
      case EVENT.savedPropertyRented:
        // Ces deux-là se lisent au croisement d'un bien et d'une personne : le
        // loyer de référence est celui de *sa* sauvegarde, pas du bien.
        return recipientId
          ? this.savedProperty(template, ref, firstName, recipientId)
          : null;

      case EVENT.applicationReceived:
      case EVENT.applicationShortlisted:
      case EVENT.applicationRejected:
      case EVENT.applicationAccepted:
        return this.application(template, ref, firstName);

      case EVENT.applicationClosedByAttribution:
        return this.applicationClosedByAttribution(ref, firstName);

      case EVENT.leaseReadyToSign:
      case EVENT.leaseSigned:
        return this.lease(template, ref, firstName);

      case EVENT.subscriptionPaymentFailed:
        return this.subscriptionPaymentFailed(ref, firstName);

      case EVENT.documentRejected:
        return this.documentRejected(ref, firstName);

      case EVENT.fileVerified:
      case EVENT.fileRejected:
        return this.tenantFile(template, ref, firstName);

      case EVENT.propertyPublished:
      case EVENT.propertyReturned:
        return this.property(template, ref, firstName);

      case EVENT.visitBooked:
      case EVENT.visitCancelled:
        return this.visit(template, ref, firstName);

      default:
        this.logger.error(`Gabarit d'événement inconnu : ${template}`);
        return null;
    }
  }

  /**
   * Candidature fermée par l'attribution du logement à un autre candidat.
   *
   * Reconstruite comme les autres, avec une vérification de plus : si la
   * candidature n'est plus fermée pour ce motif — rouverte depuis, ou tranchée
   * autrement — le message est abandonné. Il annoncerait une situation qui n'a
   * plus cours, et rien ne le rattraperait ensuite.
   *
   * L'annulation du rendez-vous n'est mentionnée que s'il y en avait un : la
   * plupart de ces candidats n'avaient pas encore de créneau.
   */
  private async applicationClosedByAttribution(
    id: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: {
        status: true,
        rejectionReason: true,
        property: { select: { reference: true, title: true } },
        visits: {
          where: {
            status: VisitStatus.CANCELLED,
            cancellationReason: ATTRIBUTION_VISIT_REASON,
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!application) return null;

    if (
      application.status !== ApplicationStatus.REJECTED ||
      application.rejectionReason !== ATTRIBUTION_REASON
    ) {
      return null;
    }

    return tpl.applicationClosedByAttribution({
      tenantFirstName: firstName,
      propertyReference: application.property.reference,
      propertyTitle: application.property.title,
      visitCancelled: application.visits.length > 0,
      url: `${this.site}/recherche`,
    });
  }

  /**
   * Événement sur un bien mis de côté.
   *
   * Reconstruit au moment de l'envoi comme les autres, avec trois raisons
   * d'abandonner : le bien n'a plus été retiré de la liste entre-temps, la
   * situation annoncée a cessé d'être vraie, ou — pour une baisse — le loyer
   * est remonté avant que le message ne parte. Annoncer un prix qui n'a plus
   * cours ferait venir quelqu'un pour rien.
   */
  private async savedProperty(
    template: string,
    propertyId: string,
    firstName: string,
    tenantId: string,
  ): Promise<RenderedTemplate | null> {
    const saved = await this.prisma.savedProperty.findUnique({
      where: { tenantId_propertyId: { tenantId, propertyId } },
      select: {
        rentCentsAtSave: true,
        property: {
          select: {
            reference: true,
            title: true,
            status: true,
            rentCents: true,
            chargesCents: true,
          },
        },
      },
    });
    // Le bien a été retiré de la liste : la personne a dit qu'il ne
    // l'intéressait plus.
    if (!saved) return null;

    const { reference, title, status } = saved.property;

    if (template === EVENT.savedPropertyRented) {
      if (status !== PropertyStatus.RENTED) return null;
      return tpl.savedPropertyRented({
        tenantFirstName: firstName,
        propertyReference: reference,
        propertyTitle: title,
        url: `${this.site}/recherche`,
      });
    }

    const actuel = saved.property.rentCents + saved.property.chargesCents;
    // Une annonce hors ligne, ou dont le loyer est remonté, n'a plus de baisse
    // à annoncer.
    if (!VISIBLE.includes(status) || saved.rentCentsAtSave <= actuel) return null;

    return tpl.savedPropertyPriceDrop({
      tenantFirstName: firstName,
      propertyReference: reference,
      propertyTitle: title,
      previousRentCents: saved.rentCentsAtSave,
      currentRentCents: actuel,
      url: `${this.site}/biens/${encodeURIComponent(reference)}`,
    });
  }

  /**
   * Bail parti en signature, ou signé.
   *
   * Abandonné si le bail a quitté l'état annoncé : un acte refusé ou annulé
   * entre-temps ne s'annonce pas « prêt à signer ».
   */
  private async lease(
    template: string,
    leaseId: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: {
        reference: true,
        status: true,
        startDate: true,
        property: { select: { reference: true } },
      },
    });
    if (!lease) return null;

    if (template === EVENT.leaseSigned) {
      if (lease.status !== LeaseStatus.SIGNED) return null;
      return tpl.leaseSigned({
        firstName,
        leaseReference: lease.reference,
        propertyReference: lease.property.reference,
        startDate: lease.startDate,
        url: `${this.site}/baux/${encodeURIComponent(lease.reference)}`,
      });
    }

    // Entre la mise en file et l'envoi, l'acte a pu être signé, refusé ou
    // annulé : « prêt à signer » ne vaut que tant qu'il attend.
    if (!AWAITING_SIGNATURE.includes(lease.status)) return null;

    return tpl.leaseReadyToSign({
      firstName,
      leaseReference: lease.reference,
      propertyReference: lease.property.reference,
      validityDays: SIGNATURE_VALIDITY_DAYS,
      url: `${this.site}/baux/${encodeURIComponent(lease.reference)}`,
    });
  }

  /**
   * Échéance d'abonnement refusée.
   *
   * Abandonnée si le règlement a finalement abouti : le prestataire relance de
   * lui-même, et annoncer un refus rattrapé ferait s'inquiéter pour rien.
   */
  private async subscriptionPaymentFailed(
    paymentId: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, amountCents: true, failureReason: true },
    });
    if (!payment || payment.status !== PaymentStatus.FAILED) return null;

    return tpl.subscriptionPaymentFailed({
      ownerFirstName: firstName,
      amountCents: payment.amountCents,
      reason: payment.failureReason,
      url: `${this.site}/proprietaires/abonnement`,
    });
  }

  private async application(
    template: string,
    id: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: {
        property: {
          select: { reference: true, title: true, rentCents: true, chargesCents: true },
        },
      },
    });
    if (!application) return null;

    const { reference, title } = application.property;

    if (template === EVENT.applicationReceived) {
      const pendingCount = await this.prisma.application.count({
        where: {
          propertyId: application.propertyId,
          status: { in: [ApplicationStatus.SUBMITTED, ApplicationStatus.READ] },
        },
      });
      return tpl.applicationReceived({
        ownerFirstName: firstName,
        propertyReference: reference,
        propertyTitle: title,
        pendingCount,
        url: `${this.site}/proprietaires/candidatures`,
      });
    }

    if (template === EVENT.applicationShortlisted) {
      return tpl.applicationShortlisted({
        tenantFirstName: firstName,
        propertyReference: reference,
        propertyTitle: title,
        url: `${this.site}/biens/${encodeURIComponent(reference)}/visite`,
      });
    }

    if (template === EVENT.applicationRejected) {
      return tpl.applicationRejected({
        tenantFirstName: firstName,
        propertyReference: reference,
        reason: application.rejectionReason,
        url: `${this.site}/recherche`,
      });
    }

    return tpl.applicationAccepted({
      tenantFirstName: firstName,
      propertyReference: reference,
      propertyTitle: title,
      rentCents: application.property.rentCents + application.property.chargesCents,
      url: `${this.site}/dossier`,
    });
  }

  private async documentRejected(
    id: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const document = await this.prisma.tenantDocument.findUnique({
      where: { id },
      select: { type: true, rejectionReason: true, status: true },
    });
    // La pièce a pu être remplacée entre-temps : annoncer un refus levé depuis
    // renverrait le locataire corriger ce qui est déjà corrigé.
    if (!document || document.status !== 'REJECTED') return null;

    return tpl.documentRejected({
      tenantFirstName: firstName,
      documentLabel: DOCUMENT_LABELS[document.type] ?? 'pièce',
      reason: document.rejectionReason ?? 'Pièce illisible ou incomplète.',
      url: `${this.site}/dossier`,
    });
  }

  private async tenantFile(
    template: string,
    id: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const file = await this.prisma.tenantFile.findUnique({
      where: { id },
      select: { reference: true },
    });
    if (!file) return null;

    return template === EVENT.fileVerified
      ? tpl.fileVerified({
          tenantFirstName: firstName,
          fileReference: file.reference,
          url: `${this.site}/recherche`,
        })
      : tpl.fileRejected({
          tenantFirstName: firstName,
          fileReference: file.reference,
          url: `${this.site}/dossier`,
        });
  }

  private async property(
    template: string,
    id: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const property = await this.prisma.property.findUnique({
      where: { id },
      select: { reference: true, title: true, reviewNote: true },
    });
    if (!property) return null;

    const url = `${this.site}/proprietaires/biens/${encodeURIComponent(property.reference)}`;

    if (template === EVENT.propertyPublished) {
      return tpl.propertyPublished({
        ownerFirstName: firstName,
        propertyReference: property.reference,
        propertyTitle: property.title,
        url,
      });
    }

    // Sans motif, le message n'a plus rien à dire : le propriétaire a
    // resoumis son annonce entre-temps — ce qui l'efface — et l'avait donc lu
    // sur son écran. Abandonné plutôt que rempli d'un texte générique : une
    // notification qui invente son propre motif vaut moins que pas de
    // notification du tout.
    if (!property.reviewNote) return null;

    return tpl.propertyReturned({
      ownerFirstName: firstName,
      propertyReference: property.reference,
      reason: property.reviewNote,
      url,
    });
  }

  private async visit(
    template: string,
    id: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      select: {
        scheduledAt: true,
        type: true,
        property: { select: { reference: true } },
      },
    });
    if (!visit) return null;

    const reference = visit.property.reference;

    return template === EVENT.visitBooked
      ? tpl.visitBooked({
          ownerFirstName: firstName,
          propertyReference: reference,
          scheduledAt: visit.scheduledAt,
          isVideo: visit.type === 'VIDEO',
          url: `${this.site}/proprietaires/biens/${encodeURIComponent(reference)}/visites`,
        })
      : tpl.visitCancelled({
          firstName,
          propertyReference: reference,
          scheduledAt: visit.scheduledAt,
          url: `${this.site}/proprietaires/biens/${encodeURIComponent(reference)}/visites`,
        });
  }
}
