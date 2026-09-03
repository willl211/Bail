import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaxFileSizeValidator } from '@nestjs/common';
import { PropertyDocumentType, UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { IncomingFile } from '../storage/storage.service';
import { CurrentUser, Roles } from '../auth/session.guard';
import type { PublicUser } from '../auth/auth.service';
import { LeaseService } from '../lease/lease.service';
import { OwnerApplicationsService } from './applications.service';
import { OwnerService } from './owner.service';
import { UpsertPropertyDto } from './dto/upsert-property.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';

/**
 * Espace propriétaire — écran 2 du build-order.
 *
 * Tout le contrôleur est réservé au rôle `OWNER`. C'est ici que le contrôle
 * d'accès s'exerce, pas dans la navigation du front : `/proprietaires/biens`
 * doit répondre 403 à un locataire qui tape l'URL à la main
 * (docs/tech-stack.md).
 */
@Controller('owner')
@Roles(UserRole.OWNER)
export class OwnerController {
  constructor(
    private readonly owner: OwnerService,
    private readonly applications: OwnerApplicationsService,
    private readonly leases: LeaseService,
  ) {}

  /** Les biens du propriétaire connecté, tous statuts confondus. */
  @Get('properties')
  properties(@CurrentUser() user: PublicUser) {
    return this.owner.listProperties(user.id);
  }

  /** Chiffres du bandeau de l'espace propriétaire. */
  @Get('summary')
  summary(@CurrentUser() user: PublicUser) {
    return this.owner.getSummary(user.id);
  }

  /**
   * Candidatures reçues sur le portefeuille.
   *
   * Lecture seule : accepter ou écarter un candidat relève de l'écran 4, pas
   * encore construit (docs/build-order.md).
   */
  @Get('applications')
  applicationsReceived(@CurrentUser() user: PublicUser) {
    return this.applications.list(user.id);
  }

  /**
   * Retient un candidat : il peut alors prendre rendez-vous pour une visite.
   *
   * Ne fige pas les autres candidatures — plusieurs candidats peuvent être
   * retenus et visiter. C'est l'acceptation finale qui tranchera.
   */
  @Post('applications/:applicationId/shortlist')
  @HttpCode(200)
  shortlistApplication(
    @CurrentUser() user: PublicUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.applications.shortlist(user.id, applicationId);
  }

  /**
   * Accepte un candidat : ouvre son bail, fige les autres candidatures du bien
   * et retire l'annonce de la diffusion.
   *
   * Un seul geste parce que c'en est un seul : le logement est attribué.
   */
  @Post('applications/:applicationId/accept')
  @HttpCode(200)
  acceptApplication(
    @CurrentUser() user: PublicUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.leases.acceptAndPrepare(user.id, applicationId);
  }

  /** Écarte un candidat, et annule le rendez-vous éventuellement pris. */
  @Post('applications/:applicationId/reject')
  @HttpCode(200)
  rejectApplication(
    @CurrentUser() user: PublicUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.applications.reject(user.id, applicationId, dto.reason);
  }

  /** Un bien du portefeuille, tel que le formulaire de dépôt doit le repeupler. */
  @Get('properties/:reference')
  property(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.owner.getForEdit(user.id, reference);
  }

  /** Ouvre un brouillon. Le formulaire de dépôt s'enregistre au fil de l'eau. */
  @Post('properties')
  createDraft(@CurrentUser() user: PublicUser, @Body() dto: UpsertPropertyDto) {
    return this.owner.createDraft(user.id, dto);
  }

  @Patch('properties/:reference')
  updateDraft(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Body() dto: UpsertPropertyDto,
  ) {
    return this.owner.updateDraft(user.id, reference, dto);
  }

  /**
   * Soumet le brouillon au contrôle de Bail. La mise en ligne effective est
   * décidée par le back-office, pas par le propriétaire.
   */
  @Post('properties/:reference/submit')
  submit(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.owner.submitForReview(user.id, reference);
  }

  /**
   * Ajoute une photo à l'annonce.
   *
   * Le fichier transite en mémoire (pas de `dest` sur l'intercepteur) : c'est
   * le service de stockage qui décide où il atterrit, selon le driver. Écrire
   * un fichier temporaire ici court-circuiterait cette décision.
   *
   * La borne de 8 Mo est appliquée par Multer **avant** que la requête soit
   * entièrement lue, et revérifiée ensuite — un `Content-Length` menteur ne
   * doit pas suffire à la contourner.
   */
  @Post('properties/:reference/photos')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }),
  )
  addPhoto(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: IncomingFile,
    @Body('caption') caption?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Aucun fichier reçu.');
    return this.owner.addPhoto(user.id, reference, file, caption);
  }

  @Delete('properties/:reference/photos/:photoId')
  @HttpCode(204)
  removePhoto(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Param('photoId') photoId: string,
  ) {
    return this.owner.removePhoto(user.id, reference, photoId);
  }

  /** Dépose un diagnostic (DPE, amiante, plomb, ERP…). PDF ou image. */
  @Post('properties/:reference/documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }),
  )
  addDocument(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 15 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: IncomingFile,
    @Body('type') type: PropertyDocumentType,
    @Body('issuedAt') issuedAt?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Aucun fichier reçu.');
    if (!type || !(type in PropertyDocumentType)) {
      throw new BadRequestException('Type de diagnostic inconnu.');
    }
    return this.owner.addDocument(user.id, reference, type, file, issuedAt);
  }

  @Delete('properties/:reference/documents/:documentId')
  @HttpCode(204)
  removeDocument(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Param('documentId') documentId: string,
  ) {
    return this.owner.removeDocument(user.id, reference, documentId);
  }

  /**
   * Lecture d'un diagnostic.
   *
   * Seule porte de sortie d'un fichier privé : le contenu ne transite qu'après
   * vérification que le demandeur possède bien le bien. `inline` plutôt
   * qu'`attachment` pour que le navigateur affiche le PDF sans le télécharger.
   */
  @Get('properties/:reference/documents/:documentId/file')
  async readDocument(
    @CurrentUser() user: PublicUser,
    @Param('reference') reference: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { stream, mimeType, fileName } = await this.owner.readDocument(
      user.id,
      reference,
      documentId,
    );

    response.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      // Un diagnostic ne doit pas finir dans un cache partagé.
      'Cache-Control': 'private, no-store',
    });

    return new StreamableFile(stream);
  }
}
