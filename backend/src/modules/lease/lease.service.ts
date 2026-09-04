import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  DocumentStatus,
  DocumentType,
  LeaseStatus,
  LeaseType,
  PreauthorizationStatus,
  Prisma,
  PropertyDocumentType,
  PropertyStatus,
  VisitStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ATTRIBUTION_REASON, ATTRIBUTION_VISIT_REASON } from '../applications/attribution';
import { EVENT } from '../mail/event.templates';
import { MailService } from '../mail/mail.service';
import { formatAddress } from '../owner/address.checks';
import {
  SIGNATURE_DRIVER,
  type SignatureDriver,
  type SignatureEvent,
} from '../signature/signature.driver';
import { renderPlainText, renderTemplate, type RenderedBlock } from './lease.renderer';
import { validateLease, type LeaseValidationReport } from './lease.validation';

/** Réglage qui autorise — ou non — la génération de baux. */
const GENERATION_SETTING = 'lease.generationEnabled';

/** Durée légale, en mois, selon le type de location. */
const LEGAL_DURATION_MONTHS: Record<LeaseType, number> = {
  [LeaseType.NU]: 36,
  [LeaseType.MEUBLE]: 12,
};

/** Validité d'une enveloppe de signature, en jours. */
const SIGNATURE_VALIDITY_DAYS = 7;

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

/** Annexes obligatoires d'un bail d'habitation, dans l'ordre de la maquette. */
const EXPECTED_ANNEXES: { type: PropertyDocumentType; label: string }[] = [
  { type: PropertyDocumentType.DPE, label: 'Diagnostic de performance énergétique' },
  { type: PropertyDocumentType.LEAD, label: 'CREP (plomb)' },
  { type: PropertyDocumentType.ERP, label: 'État des risques et pollutions' },
  { type: PropertyDocumentType.ASBESTOS, label: 'Amiante' },
];

@Injectable()
export class LeaseService {
  private readonly logger = new Logger(LeaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SIGNATURE_DRIVER) private readonly signature: SignatureDriver,
    private readonly mail: MailService,
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
        property: { select: { id: true, reference: true, leaseType: true, rentCents: true, chargesCents: true, depositCents: true, availableFrom: true } },
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
        select: { id: true },
      });

      if (visits.length > 0) {
        const visitIds = visits.map((visit) => visit.id);
        await tx.visit.updateMany({
          where: { id: { in: visitIds } },
          data: {
            status: VisitStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: ATTRIBUTION_VISIT_REASON,
            preauthorizationStatus: PreauthorizationStatus.RELEASED,
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

    const annexes = EXPECTED_ANNEXES.filter((annexe) =>
      property.documents.some(
        (document) =>
          document.type === annexe.type && document.status === DocumentStatus.VERIFIED,
      ),
    ).map((annexe) => annexe.label);

    const feesCents = feeSchedule
      ? Math.round(
          property.surfaceM2 *
            (feeSchedule.tenantVisitFeeCentsPerSqm +
              feeSchedule.tenantInventoryFeeCentsPerSqm),
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
      logementTypeHabitat: 'immeuble collectif',
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
        feesCents === null
          ? ''
          : `Honoraires à la charge du locataire : ${euros(feesCents)} TTC.`,
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
      (document) =>
        document.type === PropertyDocumentType.DPE &&
        document.status === DocumentStatus.VERIFIED,
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
      blockers.push(
        'La génération de baux est désactivée en attendant la validation juridique.',
      );
    }
    blockers.push(...validation.anomalies, ...validation.unverifiable);

    const events = (lease.signatureEvents ?? []) as {
      type: string;
      signerId?: string;
      occurredAt: string;
    }[];

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
      document: renderTemplate(lease.template.body, fieldValues),
      validation,
      signers: [
        {
          role: 'LANDLORD',
          fullName: `${lease.property.owner.firstName} ${lease.property.owner.lastName}`,
          signed: events.some(
            (event) => event.type === 'signed' && event.signerId === 'LANDLORD',
          ),
          signedAt:
            events.find(
              (event) => event.type === 'signed' && event.signerId === 'LANDLORD',
            )?.occurredAt ?? null,
        },
        {
          role: 'TENANT',
          fullName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
          signed: events.some(
            (event) => event.type === 'signed' && event.signerId === 'TENANT',
          ),
          signedAt:
            events.find((event) => event.type === 'signed' && event.signerId === 'TENANT')
              ?.occurredAt ?? null,
        },
      ],
      annexes: EXPECTED_ANNEXES.map((annexe) => {
        const document = lease.property.documents.find(
          (entry) => entry.type === annexe.type,
        );
        return {
          type: annexe.type,
          label: annexe.label,
          present: document?.status === DocumentStatus.VERIFIED,
          detail:
            document === undefined
              ? 'Non déposé'
              : document.status === DocumentStatus.VERIFIED
                ? annexe.type === PropertyDocumentType.DPE && lease.property.energyRating
                  ? `Classe ${lease.property.energyRating}`
                  : 'Vérifié'
                : 'En cours de contrôle',
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
    lease: { createdAt: Date; validatedAt: Date | null; sentForSignatureAt: Date | null; signedAt: Date | null; reference: string; template: { code: string; version: number } },
    events: { type: string; signerId?: string; occurredAt: string }[],
  ): LeaseHistoryEntry[] {
    const entries: LeaseHistoryEntry[] = events.map((event) => ({
      at: event.occurredAt,
      tone: event.type === 'declined' ? 'reject' : event.type === 'signed' ? 'ok' : 'pending',
      title:
        event.type === 'signed'
          ? `Signé par ${event.signerId === 'LANDLORD' ? 'le bailleur' : 'le locataire'}`
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
  async listFor(userId: string, role: 'OWNER' | 'TENANT'): Promise<
    { reference: string; status: LeaseStatus; propertyReference: string; propertyTitle: string; startDate: string; rentCents: number }[]
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
    const view = await this.getByReference(reference, ownerId, 'OWNER');

    if (view.blockers.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Ce bail ne peut pas être envoyé en signature.',
        blockers: view.blockers,
      });
    }
    if (view.status !== LeaseStatus.DRAFT && view.status !== LeaseStatus.FIELDS_VALIDATED) {
      throw new ConflictException('Ce bail est déjà parti en signature.');
    }

    const lease = await this.prisma.lease.findFirstOrThrow({
      where: { reference },
      include: { template: true, property: { include: { owner: true } }, tenant: true },
    });

    const text = renderPlainText(
      lease.template.body,
      (lease.fieldValues ?? {}) as Record<string, unknown>,
    );
    const content = Buffer.from(text, 'utf8');
    const checksum = createHash('sha256').update(content).digest('hex');

    const envelope = await this.signature.createEnvelope({
      reference: lease.reference,
      subject: `Bail ${lease.reference} — ${lease.property.reference}`,
      document: {
        fileName: `${lease.reference}.txt`,
        content,
        mimeType: 'text/plain',
      },
      checksum,
      signers: [
        {
          id: 'LANDLORD',
          fullName: `${lease.property.owner.firstName} ${lease.property.owner.lastName}`,
          email: lease.property.owner.email,
          role: 'LANDLORD',
        },
        {
          id: 'TENANT',
          fullName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
          email: lease.tenant.email,
          role: 'TENANT',
        },
      ],
      expiresInDays: SIGNATURE_VALIDITY_DAYS,
    });

    await this.prisma.lease.update({
      where: { id: lease.id },
      data: {
        status: LeaseStatus.SENT_FOR_SIGNATURE,
        signatureProvider: this.signature.name,
        signatureEnvelopeId: envelope.id,
        sentForSignatureAt: new Date(),
        validatedAt: new Date(),
        validationReport: view.validation as unknown as Prisma.InputJsonValue,
        signatureEvents: [
          { type: 'sent', signerId: null, occurredAt: new Date().toISOString() },
        ] as unknown as Prisma.InputJsonValue,
      },
    });

    return this.getByReference(reference, ownerId, 'OWNER');
  }

  /**
   * Vérifie l'authenticité d'une notification et en extrait l'événement.
   *
   * Délégué au driver : le contrôleur n'a pas à connaître le prestataire, et
   * la vérification de signature reste au seul endroit qui sait la faire.
   */
  parseSignatureEvent(payload: Buffer, signature: string | undefined): SignatureEvent {
    return this.signature.parseEvent(payload, signature);
  }

  /** Applique un événement du prestataire de signature. */
  async applySignatureEvent(event: SignatureEvent): Promise<boolean> {
    const lease = await this.prisma.lease.findFirst({
      where: { signatureEnvelopeId: event.envelopeId },
      select: { id: true, signatureEvents: true, status: true },
    });
    if (!lease) {
      this.logger.warn(`Événement reçu pour une enveloppe inconnue : ${event.envelopeId}`);
      return false;
    }

    const events = ((lease.signatureEvents ?? []) as { id?: string }[]).slice();
    // Les rejeux sont ordinaires chez un prestataire de signature : un même
    // événement ne doit pas compter deux fois.
    if (events.some((entry) => entry.id === event.id)) return true;

    events.push({
      id: event.id,
      ...{
        type: event.type,
        signerId: event.signerId,
        occurredAt: event.occurredAt.toISOString(),
        reason: event.reason,
      },
    } as never);

    const signedCount = events.filter(
      (entry) => (entry as { type?: string }).type === 'signed',
    ).length;

    const status =
      event.type === 'declined'
        ? LeaseStatus.DECLINED
        : event.type === 'voided'
          ? LeaseStatus.CANCELLED
          : event.type === 'completed' || signedCount >= 2
            ? LeaseStatus.SIGNED
            : signedCount === 1
              ? LeaseStatus.PARTIALLY_SIGNED
              : lease.status;

    await this.prisma.lease.update({
      where: { id: lease.id },
      data: {
        status,
        signatureEvents: events as unknown as Prisma.InputJsonValue,
        signedAt: status === LeaseStatus.SIGNED ? event.occurredAt : undefined,
        declinedAt: status === LeaseStatus.DECLINED ? event.occurredAt : undefined,
        declineReason: status === LeaseStatus.DECLINED ? event.reason : undefined,
      },
    });

    return true;
  }
}
