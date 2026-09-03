import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentType, UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { PublicUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/session.guard';
import type { IncomingFile } from '../storage/storage.service';
import { UpdateTenantFileDto } from './dto/update-tenant-file.dto';
import { UpsertGuarantorDto } from './dto/upsert-guarantor.dto';
import { TenantService } from './tenant.service';

/** 10 Mo par pièce, comme annoncé sur la zone de dépôt de la maquette. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Dossier locataire — écran 3 du build-order.
 *
 * Tout le contrôleur est réservé au rôle `TENANT`. Un propriétaire qui taperait
 * l'URL doit se voir refuser l'accès par l'API : masquer un lien dans la
 * navigation n'a jamais été un contrôle d'accès.
 */
@Controller('tenant/file')
@Roles(UserRole.TENANT)
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  file(@CurrentUser() user: PublicUser) {
    return this.tenant.getFile(user.id);
  }

  @Patch()
  update(@CurrentUser() user: PublicUser, @Body() dto: UpdateTenantFileDto) {
    return this.tenant.updateFile(user.id, dto);
  }

  /** Transmet le dossier au contrôle de Bail. */
  @Post('submit')
  submit(@CurrentUser() user: PublicUser) {
    return this.tenant.submit(user.id);
  }

  /**
   * Dépose une pièce.
   *
   * Le fichier transite en mémoire : c'est le service de stockage qui décide où
   * il atterrit, selon le driver. La borne de 10 Mo est appliquée par Multer
   * **avant** que la requête soit entièrement lue, puis revérifiée — un
   * `Content-Length` menteur ne doit pas suffire à la contourner.
   */
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  addDocument(
    @CurrentUser() user: PublicUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_BYTES })],
        fileIsRequired: true,
      }),
    )
    file: IncomingFile,
    @Body('type') type: DocumentType,
  ) {
    if (!file?.buffer) throw new BadRequestException('Aucun fichier reçu.');
    if (!type || !(type in DocumentType)) {
      throw new BadRequestException('Type de pièce inconnu.');
    }
    return this.tenant.addDocument(user.id, type, file);
  }

  @Delete('documents/:documentId')
  removeDocument(
    @CurrentUser() user: PublicUser,
    @Param('documentId') documentId: string,
  ) {
    return this.tenant.removeDocument(user.id, documentId);
  }

  /**
   * Consultation d'une pièce.
   *
   * Seule porte de sortie d'un fichier privé. `inline` plutôt qu'`attachment` :
   * le locataire veut relire sa pièce, pas la retélécharger.
   */
  @Get('documents/:documentId/file')
  async readDocument(
    @CurrentUser() user: PublicUser,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { stream, mimeType, fileName } = await this.tenant.readDocument(
      user.id,
      documentId,
    );

    response.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      // Une pièce de dossier ne doit jamais finir dans un cache partagé.
      'Cache-Control': 'private, no-store',
    });

    return new StreamableFile(stream);
  }

  @Put('guarantor')
  upsertGuarantor(@CurrentUser() user: PublicUser, @Body() dto: UpsertGuarantorDto) {
    return this.tenant.upsertGuarantor(user.id, dto);
  }

  @Delete('guarantor')
  removeGuarantor(@CurrentUser() user: PublicUser) {
    return this.tenant.removeGuarantor(user.id);
  }
}
