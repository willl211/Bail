import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationStatus, DocumentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import * as tpl from './event.templates';
import { EVENT } from './event.templates';
import type { RenderedTemplate } from './mail.templates';

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

    const message = await this.render(template, subjectRef, recipient.firstName);
    return message ? { to: recipient.email, message } : null;
  }

  private async render(
    template: string,
    ref: string,
    firstName: string,
  ): Promise<RenderedTemplate | null> {
    switch (template) {
      case EVENT.applicationReceived:
      case EVENT.applicationShortlisted:
      case EVENT.applicationRejected:
      case EVENT.applicationAccepted:
        return this.application(template, ref, firstName);

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
