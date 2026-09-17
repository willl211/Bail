import { requiredDiagnostics, diagnosticFactBlockers, energyBlockers, DIAGNOSTIC_LABELS } from '../owner/diagnostic-policy';
import { isCurrentDiagnostic, diagnosticStatus } from '../owner/property.checks';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  DocumentStatus,
  DocumentType,
  LeaseStatus,
  LeaseType,
  Prisma,
  PropertyDocumentType,
  PropertyStatus,
  VisitStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';
import { renderLeasePdf } from './lease.pdf';
import type { SignatureEnvelopeInput } from '../signature/signature.driver';
import { PrismaService } from '../../prisma/prisma.service';
import { ATTRIBUTION_REASON, ATTRIBUTION_VISIT_REASON } from '../applications/attribution';
import { EVENT } from '../mail/event.templates';
import { MailService } from '../mail/mail.service';
import { SavedService } from '../saved/saved.service';
import { formatAddress } from '../owner/address.checks';
import {
  SIGNATURE_DRIVER,
  type SignatureDriver,
  type SignatureEvent,
} from '../signature/signature.driver';
import { renderPlainText, renderTemplate, type RenderedBlock } from './lease.renderer';
import { SIGNATURE_VALIDITY_DAYS } from './signature.validity';
import {
  acceptsSignatureEvents,
  nextSignatureStatus,
  signatureEventsOf,
  signatureProgress,
} from './lease-signature.policy';
import { validateSignatureEvent } from '../signature/signature-event.validation';
import { validateLease, type LeaseValidationReport } from './lease.validation';

/** Réglage qui autorise — ou non — la génération de baux. */
const GENERATION_SETTING = 'lease.generationEnabled';

/** Durée légale, en mois, selon le type de location. */
const LEGAL_DURATION_MONTHS: Record<LeaseType, number> = {
  [LeaseType.NU]: 36,
  [LeaseType.MEUBLE]: 12,
};

export interface LeaseSignerView {
  role: 'LANDLORD' | 'TENANT';
  fullName: string;
  signed: boolean;
  signedAt: string | null;
}

export interface LeaseAnnexView {
  type: PropertyDocumentType;
  label: string;
  present: boolean;
  detail: string;
}

export interface LeaseHistoryEntry {
  at: string;
  tone: 'ok' | 'pending' | 'reject' | 'neutral';
  title: string;
  note: string;
}

export interface LeaseView {
  reference: string;
  status: LeaseStatus;
  type: LeaseType;
  propertyReference: string;
  propertyTitle: string;
  addressLine: string;
  templateLabel: string;
  templateCode: string;
  templateVersion: number;
  /** Le modèle a-t-il été publié ? Faux tant qu'aucun texte d'avocat n'existe. */
  templatePublished: boolean;
  startDate: string;
  endDate: string;
  durationMonths: number;
  rentCents: number;
  chargesCents: number;
  depositCents: number;
  /** Le texte rendu, découpé pour distinguer modèle et valeurs injectées. */
  document: RenderedBlock[];
  validation: LeaseValidationReport | null;
  signers: LeaseSignerView[];
  annexes: LeaseAnnexView[];
  history: LeaseHistoryEntry[];
  /** Ce qui empêche d'envoyer en signature. Vide = prêt à signer. */
  blockers: string[];
  signatureDriver: string;
  sentForSignatureAt: string | null;
  signedAt: string | null;
}

@Injectable()
export class LeaseService {
  private readonly logger = new Logger(LeaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SIGNATURE_DRIVER) private readonly signature: SignatureDriver,
    private readonly mail: MailService,
    private readonly saved: SavedService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- Réglages

  /**
   * La génération de baux est-elle autorisée ?
   *
   * Réglage en base, faux par défaut : tant qu'aucun modèle validé par un
   * avocat n'est publié, produire un bail donnerait un acte sans clauses —
   * juridiquement vide, et pire qu'aucun document (docs/legal-context.md).
   */
  private async generationEnabled(): Promise<boolean> {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: GENERATION_SETTING },
    });
    return setting?.value === true;
  }

  /** Modèle applicable au type de location. */
  private async templateFor(type: LeaseType) {
    // Le modèle publié d'abord ; à défaut, le squelette, pour que la chaîne
    // reste exerçable et que l'écran montre ce qui manque au lieu d'un vide.
    const published = await this.prisma.leaseTemplate.findFirst({
      where: { type, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (published) return published;

    const skeleton = await this.prisma.leaseTemplate.findFirst({
      where: { type },
      orderBy: { version: 'desc' },
    });
    if (!skeleton) {
      throw new BadRequestException(
        'Aucun modèle de bail n’est enregistré pour ce type de location.',
      );
    }
    return skeleton;
  }

  // ---------------------------------------------------------------- Création

  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `BAIL-${new Date().getFullYear()}-`;
    const last = await tx.lease.findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const current = last ? parseInt(last.reference.slice(prefix.length), 10) : 0;
    return `${prefix}${String(current + 1).padStart(4, '0')}`;
  }

  /**
   * Accepte un candidat et ouvre son bail.
   *
   * Un seul geste, parce que c'en est un seul du point de vue du propriétaire :
   * accepter fige les autres candidatures du bien et déclenche la préparation
   * de l'acte. Les deux dans la même transaction — accepter sans figer
   * laisserait deux candidats croire qu'ils sont retenus.
   */
  async acceptAndPrepare(ownerId: string, applicationId: string): Promise<LeaseView> {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, property: { ownerId } },
      include: {
        property: {
          select: {
            id: true,
            reference: true,
            leaseType: true,
            rentCents: true,
            chargesCents: true,
            depositCents: true,
            availableFrom: true,
          },
        },
        tenant: { select: { id: true } },
      },
    });
    // 404 et non 403 : « interdit » confirmerait que la candidature existe.
    if (!application) throw new NotFoundException('Candidature introuvable.');

    if (application.status === ApplicationStatus.ACCEPTED) {
      const existing = await this.prisma.lease.findFirst({
        where: { applicationId: application.id },
        select: { reference: true },
      });
      if (existing) return this.getByReference(existing.reference, ownerId, 'OWNER');
      throw new ConflictException('Cette candidature est déjà acceptée.');
    }
    if (
      application.status === ApplicationStatus.REJECTED ||
      application.status === ApplicationStatus.WITHDRAWN ||
      application.status === ApplicationStatus.EXPIRED
    ) {
      throw new ConflictException('Cette candidature est close.');
    }

    const property = application.property;
    const template = await this.templateFor(property.leaseType);
    const durationMonths = LEGAL_DURATION_MONTHS[property.leaseType];

    const startDate = property.availableFrom ?? new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);

    const fieldValues = await this.buildFieldValues(application.id, startDate, durationMonths);

    const attribution = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "properties" WHERE "id" = ${property.id} FOR UPDATE`;
      const leaseReference = await this.nextReference(tx);

      await tx.lease.create({
        data: {
          reference: leaseReference,
          propertyId: property.id,
          tenantId: application.tenantId,
          applicationId: application.id,
          templateId: template.id,
          templateChecksum: template.checksum,
          type: property.leaseType,
          fieldValues,
          startDate,
          endDate,
          durationMonths,
          rentCents: property.rentCents,
          chargesCents: property.chargesCents,
          depositCents: property.depositCents,
        },
      });

      await tx.application.update({
        where: { id: application.id },
        data: {
          status: ApplicationStatus.ACCEPTED,
          decidedAt: new Date(),
          // Un dossier accepté ne garde pas de motif de refus : le laisser
          // afficherait « accepté » et « écarté parce que… » sur le même écran.
          rejectionReason: null,
        },
      });

      // Les autres candidatures du bien sont figées : le logement est pris, et
      // les laisser « en étude » ferait attendre des gens pour rien. On les
      // relève avant de les fermer : `updateMany` ne rend pas les lignes
      // touchées, or il faut savoir qui prévenir.
      const closed = await tx.application.findMany({
        where: {
          propertyId: property.id,
          id: { not: application.id },
          status: {
            in: [
              ApplicationStatus.SUBMITTED,
              ApplicationStatus.READ,
              ApplicationStatus.SHORTLISTED,
              ApplicationStatus.VISIT_SCHEDULED,
            ],
          },
        },
        select: { id: true, tenantId: true },
      });
      const closedIds = closed.map((entry) => entry.id);

      await tx.application.updateMany({
        where: { id: { in: closedIds } },
        data: {
          status: ApplicationStatus.REJECTED,
          rejectionReason: ATTRIBUTION_REASON,
          decidedAt: new Date(),
        },
      });

      // Les rendez-vous que portaient ces candidatures n'ont plus d'objet : le
      // bien est loué. Sans cette annulation, un candidat se déplacerait pour
      // visiter un logement déjà attribué — et le propriétaire l'y attendrait.
      // Même traitement que sur un refus explicite, créneau rendu compris.
      const visits = await tx.visit.findMany({
        where: {
          applicationId: { in: closedIds },
          status: {
            in: [VisitStatus.REQUESTED, VisitStatus.PENDING_CHECKS, VisitStatus.CONFIRMED],
          },
        },
        select: { id: true, tenantId: true, agentId: true, property: { select: { ownerId: true } } },
      });

      for (const visit of visits) {
        for (const userId of [visit.tenantId, visit.property.ownerId, visit.agentId].filter((id): id is string => !!id)) {
          await this.mail.enqueueInTransaction(tx, { template: EVENT.visitCancelled, userId, subjectRef: visit.id,
            dedupeKey: 'visit-cancelled:' + visit.id + ':' + userId });
        }
      }
      if (visits.length > 0) {
        const visitIds = visits.map((visit) => visit.id);
        await tx.visit.updateMany({
          where: { id: { in: visitIds } },
          data: {
            status: VisitStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: ATTRIBUTION_VISIT_REASON,
            videoRoomUrl: null,
          },
        });
        // Le créneau redevient libre : le bien sort de la diffusion, mais le
        // propriétaire garde un calendrier qui dit la vérité.
        await tx.visitSlot.updateMany({
          where: { visitId: { in: visitIds } },
          data: { visitId: null },
        });
      }

      // Le bien sort de la diffusion : il est loué, le laisser en ligne
      // continuerait d'attirer des candidatures sans objet — et de le facturer.
      await tx.property.update({
        where: { id: property.id },
        data: { status: PropertyStatus.RENTED, rentedAt: new Date() },
      });

      return { leaseReference, closed };
    });

    const { leaseReference: reference, closed } = attribution;

    // Hors transaction : la mise en file ne doit pas pouvoir faire échouer
    // l'attribution, et une attribution annulée ne doit pas laisser partir un
    // message.
    await this.mail.enqueue({
      template: EVENT.applicationAccepted,
      userId: application.tenantId,
      subjectRef: application.id,
    });

    // Les candidatures que l'attribution vient de fermer reçoivent leur propre
    // message. Employer le gabarit du refus annoncerait une décision que
    // personne n'a formulée : ces dossiers n'ont pas été écartés, le logement
    // est simplement parti.
    for (const entry of closed) {
      await this.mail.enqueue({
        template: EVENT.applicationClosedByAttribution,
        userId: entry.tenantId,
        subjectRef: entry.id,
      });
    }

    // Le bien sort de la diffusion : ceux qui l'avaient mis de côté sans
    // candidater ne l'apprendraient autrement qu'en revenant sur leur liste.
    // Les candidats en sont exclus — ils viennent de recevoir leur réponse.
    await this.saved.notifyRented(property.id);

    this.logger.log(
      `Bail ${reference} ouvert pour la candidature ${application.id}` +
        (closed.length > 0 ? `, ${closed.length} candidature(s) fermée(s).` : '.'),
    );
    return this.getByReference(reference, ownerId, 'OWNER');
  }

  /**
   * Construit les valeurs à injecter.
   *
   * Chaque valeur vient d'une donnée en base — bien, dossier, barème. Aucune
   * n'est composée pour l'occasion : ce qui n'existe pas reste vide, et le
   * contrôle de cohérence le signale.
   */
  private async buildFieldValues(
    applicationId: string,
    startDate: Date,
    durationMonths: number,
  ): Promise<Record<string, string>> {
    const application = await this.prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        property: {
          include: { district: true, owner: true, documents: true },
        },
        tenant: true,
      },
    });

    const property = application.property;
    const owner = property.owner;
    const feeSchedule = await this.prisma.feeSchedule.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });

    const euros = (cents: number) =>
      `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    const annexes = requiredDiagnostics(property).map((type) => ({ type, label: DIAGNOSTIC_LABELS[type] })).filter((annexe) =>
      property.documents.some(
        (document) => document.type === annexe.type && isCurrentDiagnostic(document),
      ),
    ).map((annexe) => annexe.label);

    const feesCents = feeSchedule
      ? Math.round(
          property.surfaceM2 *
            (feeSchedule.tenantVisitFeeCentsPerSqm + feeSchedule.tenantInventoryFeeCentsPerSqm),
        )
      : null;

    return {
      titreContrat:
        property.leaseType === LeaseType.MEUBLE
          ? 'Contrat de location — logement meublé'
          : 'Contrat de location — logement vide',
      bailleurNomComplet: `${owner.firstName} ${owner.lastName}`,
      // Adresse du bailleur, obligatoire au bail (loi n° 89-462, article 3).
      // Reste vide si le propriétaire ne l'a pas renseignée dans son espace :
      // le contrôle de complétude le signale et refuse l'envoi en signature,
      // plutôt que d'inventer un domicile ou de retomber sur celui du logement.
      bailleurAdresse: formatAddress(owner),
      locataireNomComplet: `${application.tenant.firstName} ${application.tenant.lastName}`,
      logementAdresse: `${property.addressLine}, ${property.postalCode} ${property.city}`,
      logementTypeHabitat: property.propertyType === 'HOUSE' ? 'maison individuelle' : 'immeuble collectif',
      logementSurfaceM2: String(property.surfaceM2),
      logementNombrePieces: String(property.rooms),
      bailDateDebut: startDate.toLocaleDateString('fr-FR'),
      bailDureeMois: String(durationMonths),
      loyerMensuel: euros(property.rentCents),
      provisionCharges: euros(property.chargesCents),
      depotGarantie: euros(property.depositCents),
      travauxMention: '',
      garantiesMention: '',
      // Champ verrouillé : son contenu vient du modèle de l'avocat, jamais
      // d'ici. Il reste vide tant que le texte n'est pas fourni.
      clausesLegalesTexteValide: '',
      honorairesMention:
        feesCents === null ? '' : `Honoraires à la charge du locataire : ${euros(feesCents)} TTC.`,
      listeAnnexes: annexes.length > 0 ? annexes.join(', ') : '',
    };
  }

  // ---------------------------------------------------------------- Lecture

  /** Bail lisible par son titulaire — locataire, propriétaire du bien, ou agent. */
  async getByReference(
    reference: string,
    userId: string,
    role: 'OWNER' | 'TENANT' | 'AGENT',
  ): Promise<LeaseView> {
    const lease = await this.prisma.lease.findFirst({
      where: {
        reference,
        // Un agent voit tout ; les deux parties ne voient que le leur. 404 sur
        // le bail d'autrui plutôt que 403 : « interdit » confirmerait qu'il
        // existe.
        ...(role === 'AGENT'
          ? {}
          : role === 'OWNER'
            ? { property: { ownerId: userId } }
            : { tenantId: userId }),
      },
      include: {
        template: true,
        property: {
          include: { district: true, owner: true, documents: true },
        },
        tenant: true,
      },
    });
    if (!lease) throw new NotFoundException('Bail introuvable.');

    const fieldValues = (lease.fieldValues ?? {}) as Record<string, unknown>;
    const fieldSchema = (lease.template.fieldSchema ?? {}) as Record<
      string,
      { type: string; required?: boolean; min?: number }
    >;

    const identityVerified = await this.tenantIdentityVerified(lease.tenantId);
    const energyDocument = lease.property.documents.find(
      (document) => document.type === PropertyDocumentType.DPE && isCurrentDiagnostic(document),
    );

    const validation = validateLease({
      leaseType: lease.type,
      fieldValues,
      fieldSchema,
      property: {
        reference: lease.property.reference,
        leaseType: lease.property.leaseType,
        surfaceM2: lease.property.surfaceM2,
        rooms: lease.property.rooms,
        rentCents: lease.property.rentCents,
        chargesCents: lease.property.chargesCents,
        depositCents: lease.property.depositCents,
        energyRating: lease.property.energyRating,
        hasEnergyDocument: energyDocument !== undefined,
      },
      landlord: {
        fullName: `${lease.property.owner.firstName} ${lease.property.owner.lastName}`,
      },
      tenant: {
        fullName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        identityVerified,
      },
      lease: {
        rentCents: lease.rentCents,
        chargesCents: lease.chargesCents,
        depositCents: lease.depositCents,
        durationMonths: lease.durationMonths,
      },
      templateChecksum: lease.templateChecksum,
      storedChecksum: lease.template.checksum,
    });

    const generationEnabled = await this.generationEnabled();
    const templatePublished = lease.template.isActive && lease.template.publishedAt !== null;

    const blockers: string[] = [];
    if (!templatePublished) {
      blockers.push(
        'Le modèle légal n’est pas publié : le texte de l’avocat n’a pas encore été fourni. Envoyer ce document en signature produirait un bail sans clauses.',
      );
    }
    if (!generationEnabled) {
      blockers.push('La génération de baux est désactivée en attendant la validation juridique.');
    }
    blockers.push(...validation.anomalies, ...validation.unverifiable);
    blockers.push(...energyBlockers(lease.property.energyRating, lease.startDate > new Date() ? lease.startDate : new Date()), ...diagnosticFactBlockers(lease.property));
    for (const type of requiredDiagnostics(lease.property)) {
      if (!lease.property.documents.some((doc) => doc.type === type && isCurrentDiagnostic(doc)))
        blockers.push(`${DIAGNOSTIC_LABELS[type]} : diagnostic vérifié et valide requis avant signature`);
    }

    const events = signatureEventsOf(lease.signatureEvents);
    const progress = signatureProgress(events);
    const snapshot = lease.signatureRequest as { view?: Pick<LeaseView, 'document' | 'annexes' | 'signers'> } | null;

    return {
      reference: lease.reference,
      status: lease.status,
      type: lease.type,
      propertyReference: lease.property.reference,
      propertyTitle: lease.property.title,
      addressLine: `${lease.property.addressLine}, ${lease.property.postalCode} ${lease.property.city}`,
      templateLabel: lease.template.label,
      templateCode: lease.template.code,
      templateVersion: lease.template.version,
      templatePublished,
      startDate: lease.startDate.toISOString(),
      endDate: lease.endDate.toISOString(),
      durationMonths: lease.durationMonths,
      rentCents: lease.rentCents,
      chargesCents: lease.chargesCents,
      depositCents: lease.depositCents,
      document: snapshot?.view?.document ?? renderTemplate(lease.template.body, fieldValues),
      validation,
      signers: progress.signers.map((signer) => ({
        ...signer,
        fullName: snapshot?.view?.signers.find(frozen => frozen.role === signer.role)?.fullName ?? (
          signer.role === 'LANDLORD'
            ? `${lease.property.owner.firstName} ${lease.property.owner.lastName}`
            : `${lease.tenant.firstName} ${lease.tenant.lastName}`),
      })),
      annexes: snapshot?.view?.annexes ?? requiredDiagnostics(lease.property).map((type) => ({ type, label: DIAGNOSTIC_LABELS[type] })).map((annexe) => {
        const document = lease.property.documents.find((entry) => entry.type === annexe.type);
        return {
          type: annexe.type,
          label: annexe.label,
          present: document !== undefined && isCurrentDiagnostic(document),
          detail:
            document === undefined
              ? 'Non déposé'
              : isCurrentDiagnostic(document)
                ? annexe.type === PropertyDocumentType.DPE && lease.property.energyRating
                  ? `Classe ${lease.property.energyRating}`
                  : 'Vérifié'
                : diagnosticStatus(document) === 'EXPIRED'
                  ? 'Expiré'
                  : document.status === DocumentStatus.REJECTED
                    ? 'Refusé'
                    : 'À contrôler',
        };
      }),
      history: LeaseService.historyOf(lease, events),
      blockers,
      signatureDriver: this.signature.name,
      sentForSignatureAt: lease.sentForSignatureAt?.toISOString() ?? null,
      signedAt: lease.signedAt?.toISOString() ?? null,
    };
  }

  /** La pièce d'identité du locataire est-elle vérifiée ? */
  private async tenantIdentityVerified(tenantId: string): Promise<boolean> {
    const count = await this.prisma.tenantDocument.count({
      where: {
        tenantFile: { tenantId },
        type: { in: [DocumentType.ID_CARD, DocumentType.PASSPORT] },
        status: DocumentStatus.VERIFIED,
      },
    });
    return count > 0;
  }

  /** Historique du document, reconstitué sur des faits datés. */
  private static historyOf(
    lease: {
      createdAt: Date;
      validatedAt: Date | null;
      sentForSignatureAt: Date | null;
      signedAt: Date | null;
      reference: string;
      template: { code: string; version: number };
    },
    events: { type: string; signerId?: string | null; occurredAt: string }[],
  ): LeaseHistoryEntry[] {
    const entries: LeaseHistoryEntry[] = events.map((event) => ({
      at: event.occurredAt,
      tone: event.type === 'declined' ? 'reject' : event.type === 'signed' ? 'ok' : 'pending',
      title:
        event.type === 'signed'
          ? `Signature reçue : ${event.signerId === 'LANDLORD' ? 'bailleur' : event.signerId === 'TENANT' ? 'locataire' : 'signataire inconnu'}`
          : event.type === 'sent'
            ? 'Envoyé aux signataires'
            : event.type === 'declined'
              ? 'Signature refusée'
              : `Événement ${event.type}`,
      note: 'Horodatage du prestataire de signature',
    }));

    if (lease.validatedAt) {
      entries.push({
        at: lease.validatedAt.toISOString(),
        tone: 'ok',
        title: 'Cohérence vérifiée',
        note: 'Contrôle déterministe des champs',
      });
    }

    entries.push({
      at: lease.createdAt.toISOString(),
      tone: 'neutral',
      title: 'Bail ouvert',
      note: `Modèle ${lease.template.code} v${lease.template.version}`,
    });

    return entries.sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Baux d'un utilisateur, selon son rôle. */
  async listFor(
    userId: string,
    role: 'OWNER' | 'TENANT',
  ): Promise<
    {
      reference: string;
      status: LeaseStatus;
      propertyReference: string;
      propertyTitle: string;
      startDate: string;
      rentCents: number;
    }[]
  > {
    const leases = await this.prisma.lease.findMany({
      where: role === 'OWNER' ? { property: { ownerId: userId } } : { tenantId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        reference: true,
        status: true,
        startDate: true,
        rentCents: true,
        property: { select: { reference: true, title: true } },
      },
    });

    return leases.map((lease) => ({
      reference: lease.reference,
      status: lease.status,
      propertyReference: lease.property.reference,
      propertyTitle: lease.property.title,
      startDate: lease.startDate.toISOString(),
      rentCents: lease.rentCents,
    }));
  }

  // -------------------------------------------------------------- Signature

  /**
   * Envoie le bail en signature.
   *
   * Refuse tant qu'un blocage subsiste. C'est le point où le refus compte le
   * plus : une fois l'enveloppe partie, deux personnes signent un texte, et un
   * bail sans clauses ne se rattrape pas après coup.
   */
  async sendForSignature(reference: string, ownerId: string): Promise<LeaseView> {
    const lease = await this.prisma.lease.findFirst({ where: { reference, property: { ownerId } },
      include: { template: true, property: { include: { owner: true, documents: true } }, tenant: true },
    });
    if (!lease) throw new NotFoundException('Bail introuvable.');
    if (lease.signatureEnvelopeId) return this.getByReference(reference, ownerId, 'OWNER');
    // Une tentative déjà préparée a pu être acceptée par le prestataire avant
    // la perte de réponse. La reprendre ne doit pas reconstruire un autre acte.
    if (lease.signatureRequest) {
      if (lease.signatureProvider !== this.signature.name) throw new ConflictException('Le prestataire a changé depuis la préparation du bail.');
      if (!['DRAFT', 'FIELDS_VALIDATED'].includes(lease.status)) throw new ConflictException('Ce bail ne peut plus être envoyé.');
      const envelope = await this.signature.createEnvelope(this.signatureInput(lease.signatureRequest));
      await this.attachEnvelope(lease.id, envelope.id);
      return this.getByReference(reference, ownerId, 'OWNER');
    }
    const view = await this.getByReference(reference, ownerId, 'OWNER');
    if (view.blockers.length) throw new BadRequestException({ message: 'Ce bail ne peut pas être envoyé en signature.', blockers: view.blockers });
    if (!['DRAFT', 'FIELDS_VALIDATED'].includes(lease.status)) throw new ConflictException('Ce bail ne peut plus être envoyé.');

    const reserved = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'signature:' + lease.id}))`;
      await tx.$executeRaw`SELECT "id" FROM "properties" WHERE "id" = ${lease.propertyId} FOR UPDATE`;
      const current = await tx.lease.findUniqueOrThrow({ where: { id: lease.id } });
      if (current.signatureRequest) return current;
      if (current.updatedAt.getTime() !== lease.updatedAt.getTime()) throw new ConflictException('Le bail a changé. Actualisez la page.');
      const template = await tx.leaseTemplate.findUniqueOrThrow({ where: { id: lease.templateId } });
      if (!template.isActive || !template.publishedAt || template.checksum !== lease.templateChecksum || createHash('sha256').update(template.body).digest('hex') !== lease.templateChecksum) throw new ConflictException('Le modèle légal a changé.');
      let pdf;
      try { pdf = await renderLeasePdf(renderPlainText(template.body, lease.fieldValues as Record<string, unknown>), reference); }
      catch { throw new BadRequestException('Le texte du bail ne peut pas être mis en PDF sans perte. Contrôle du modèle nécessaire.'); }
      const annexes = [];
      let total = pdf.content.length;
      for (const type of requiredDiagnostics(lease.property)) {
        const document = lease.property.documents.find(d => d.type === type && isCurrentDiagnostic(d));
        if (!document?.storageKey) throw new BadRequestException('Annexe obligatoire indisponible.');
        const content = await this.readPrivateBytes(document.storageKey, 12 * 1024 * 1024 - total);
        total += content.length;
        const mimeType = content.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
          : content[0] === 0xff && content[1] === 0xd8 ? 'image/jpeg'
          : content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : '';
        if (!mimeType) throw new BadRequestException('Une annexe doit être remplacée par un PDF, JPEG ou PNG lisible.');
        annexes.push({ fileName: type + (mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/jpeg' ? '.jpg' : '.png'), mimeType, content: content.toString('base64') });
      }
      const property = await tx.property.findUniqueOrThrow({ where: { id: lease.propertyId } });
      if (property.reviewRevision !== lease.property.reviewRevision) throw new ConflictException('Les diagnostics du bien ont changé. Actualisez la page.');
      const transactionId = randomUUID(); const requestedAt = new Date();
      const snapshot = { reference, subject: 'Bail ' + reference + ' — ' + lease.property.reference,
        view: { document: view.document, annexes: view.annexes, signers: view.signers },
        transactionId, requestedAt: requestedAt.toISOString(), expiresInDays: SIGNATURE_VALIDITY_DAYS,
        checksum: createHash('sha256').update(pdf.content).digest('hex'),
        document: { fileName: reference + '.pdf', content: pdf.content.toString('base64'), mimeType: 'application/pdf', signaturePage: pdf.signaturePage }, annexes,
        signers: [
          { id: 'LANDLORD', role: 'LANDLORD', fullName: lease.property.owner.firstName + ' ' + lease.property.owner.lastName, email: lease.property.owner.email },
          { id: 'TENANT', role: 'TENANT', fullName: lease.tenant.firstName + ' ' + lease.tenant.lastName, email: lease.tenant.email },
        ],
      };
      return tx.lease.update({ where: { id: lease.id }, data: { signatureRequestId: transactionId, signatureRequestedAt: requestedAt,
        signatureProvider: this.signature.name, signatureRequest: snapshot as unknown as Prisma.InputJsonValue, validationReport: view.validation as unknown as Prisma.InputJsonValue } });
    }, { timeout: 20_000 });
    if (reserved.signatureProvider !== this.signature.name) throw new ConflictException('Le prestataire a changé depuis la préparation du bail.');
    const envelope = await this.signature.createEnvelope(this.signatureInput(reserved.signatureRequest));
    await this.attachEnvelope(lease.id, envelope.id);
    return this.getByReference(reference, ownerId, 'OWNER');
  }

  private signatureInput(value: Prisma.JsonValue | null): SignatureEnvelopeInput {
    const raw = value as unknown as Omit<SignatureEnvelopeInput, 'document' | 'annexes'> & {
      document: { fileName: string; mimeType: string; content: string; signaturePage: number };
      annexes: { fileName: string; mimeType: string; content: string }[];
    };
    if (!raw?.transactionId || !raw.document) throw new ConflictException('Instantané de signature absent.');
    return { ...raw, document: { ...raw.document, content: Buffer.from(raw.document.content, 'base64') },
      annexes: raw.annexes.map(file => ({ ...file, content: Buffer.from(file.content, 'base64') })) };
  }

  private async readPrivateBytes(key: string, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = []; let size = 0;
    try {
      const stream = await this.storage.read('private', key);
      for await (const value of stream) { const chunk = Buffer.from(value); size += chunk.length;
        if (size > limit) { stream.destroy(); throw new Error('size'); } chunks.push(chunk); }
    } catch { throw new BadRequestException('Fichier privé indisponible ou dossier supérieur à 12 Mo.'); }
    if (!size) throw new BadRequestException('Annexe vide.');
    return Buffer.concat(chunks);
  }

  private async attachEnvelope(leaseId: string, envelopeId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT "id" FROM "leases" WHERE "id" = ${leaseId} FOR UPDATE`;
      const current = await tx.lease.findUniqueOrThrow({ where: { id: leaseId }, include: { property: true } });
      if (current.signatureEnvelopeId) {
        if (current.signatureEnvelopeId !== envelopeId) throw new ConflictException('Deux enveloppes différentes détectées : rapprochement nécessaire.');
        return;
      }
      if (!['DRAFT', 'FIELDS_VALIDATED'].includes(current.status)) throw new ConflictException('Le bail ne peut plus être envoyé.');
      await tx.lease.update({ where: { id: leaseId }, data: { signatureEnvelopeId: envelopeId, status: 'SENT_FOR_SIGNATURE', sentForSignatureAt: new Date(), validatedAt: new Date(),
        signatureEvents: [{ type: 'sent', signerId: null, occurredAt: new Date().toISOString() }] } });
      for (const userId of [current.property.ownerId, current.tenantId]) await this.mail.enqueueInTransaction(tx, {
        template: EVENT.leaseReadyToSign, userId, subjectRef: leaseId, dedupeKey: EVENT.leaseReadyToSign + ':' + leaseId + ':' + userId,
      });
    });
  }

  async receiveSignatureEvent(event: SignatureEvent): Promise<boolean> {
    if (this.signature.name !== 'docusign' || !this.signature.readEvents) return this.applySignatureEvent(event);
    let lease = await this.prisma.lease.findFirst({ where: { signatureEnvelopeId: event.envelopeId } });
    if (!lease && this.signature.requestIdFor) {
      const requestId = await this.signature.requestIdFor(event.envelopeId);
      if (requestId) lease = await this.prisma.lease.findUnique({ where: { signatureRequestId: requestId } });
    }
    if (!lease || lease.signatureProvider !== 'docusign') return false;
    const input = this.signatureInput(lease.signatureRequest);
    const events = await this.signature.readEvents(event.envelopeId, input.signers);
    await this.attachEnvelope(lease.id, event.envelopeId);
    for (const update of events) await this.applySignatureEvent(update);
    return true;
  }

  async downloadSigned(reference: string, userId: string, role: 'OWNER' | 'TENANT' | 'AGENT') {
    const view = await this.getByReference(reference, userId, role);
    const lease = await this.prisma.lease.findUniqueOrThrow({ where: { reference } });
    if (view.status !== 'SIGNED' || !lease.signatureEnvelopeId || lease.signatureProvider !== this.signature.name) throw new ConflictException('Le bail signé n’est pas disponible.');
    return this.signature.downloadSigned(lease.signatureEnvelopeId);
  }

  /**
   * Vérifie l'authenticité d'une notification et en extrait l'événement.
   *
   * Délégué au driver : le contrôleur n'a pas à connaître le prestataire, et
   * la vérification de signature reste au seul endroit qui sait la faire.
   */
  parseSignatureEvent(
    payload: Buffer,
    signature: string | undefined,
    actorRole?: string,
  ): SignatureEvent {
    if (this.signature.name === 'mock' && actorRole !== 'AGENT') {
      throw new ForbiddenException(
        'Les notifications de signature simulées sont réservées à un agent connecté.',
      );
    }
    return this.signature.parseEvent(payload, signature);
  }

  /** Applique un événement du prestataire de signature. */
  async applySignatureEvent(event: SignatureEvent): Promise<boolean> {
    validateSignatureEvent(event);
    return this.prisma.$transaction(async (tx) => {
      // Le verrou précède la lecture de l'historique. Deux webhooks simultanés
      // voient ainsi les signatures déjà enregistrées, sans écraser l'autre.
      const matches = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "leases" WHERE "signatureEnvelopeId" = ${event.envelopeId} FOR UPDATE
      `;
      if (matches.length !== 1) {
        this.logger.warn('Notification de signature ignorée : enveloppe inconnue ou ambiguë.');
        return false;
      }
      const lease = await tx.lease.findUniqueOrThrow({
        where: { id: matches[0].id },
        include: { property: { select: { ownerId: true } } },
      });
      if (lease.signatureProvider !== this.signature.name) {
        this.logger.warn('Notification ignorée : le prestataire ne correspond pas à l’enveloppe.');
        return false;
      }
      const events = signatureEventsOf(lease.signatureEvents);
      if (events.some((entry) => entry.id === event.id)) return true;
      if (!acceptsSignatureEvents(lease.status)) {
        // Accuser réception évite les rejeux inutiles ; l'état final et sa date
        // ne changent jamais à cause d'une notification tardive.
        this.logger.log(`Notification ignorée pour le bail ${lease.reference} (${lease.status}).`);
        return true;
      }
      const stored = {
        id: event.id,
        type: event.type,
        signerId: event.signerId,
        occurredAt: event.occurredAt.toISOString(),
        reason: event.reason,
      };
      events.push(stored);
      let status = nextSignatureStatus(events, stored);
      if (this.signature.name === 'docusign' && status === LeaseStatus.SIGNED && !events.some(entry => entry.type === 'completed')) status = LeaseStatus.PARTIALLY_SIGNED;
      await tx.lease.update({
        where: { id: lease.id },
        data: {
          status,
          signatureEvents: events as unknown as Prisma.InputJsonValue,
          signedAt: status === LeaseStatus.SIGNED ? signatureProgress(events).signedAt : null,
          declinedAt: status === LeaseStatus.DECLINED ? event.occurredAt : undefined,
          declineReason: status === LeaseStatus.DECLINED ? event.reason : undefined,
        },
      });
      if (status === LeaseStatus.SIGNED) {
        for (const userId of [lease.property.ownerId, lease.tenantId]) {
          await this.mail.enqueueInTransaction(tx, {
            template: EVENT.leaseSigned,
            userId,
            subjectRef: lease.id,
            dedupeKey: `${EVENT.leaseSigned}:${lease.id}:${userId}`,
          });
        }
      }
      return true;
    });
  }
}
