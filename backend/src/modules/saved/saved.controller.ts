import { Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PublicUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/session.guard';
import { SavedService } from './saved.service';

/**
 * Biens sauvegardés — réservé au locataire.
 *
 * Un compte est exigé, et c'est assumé : sans lui, il n'y a rien à quoi
 * rattacher la liste, et une sauvegarde qui ne survivrait pas à la fermeture du
 * navigateur ne rendrait pas le service attendu. Le front conduit donc le
 * visiteur anonyme vers la création de compte en conservant son intention,
 * comme il le fait déjà pour une candidature.
 */
@Controller('tenant/saved')
@Roles(UserRole.TENANT)
export class SavedController {
  constructor(private readonly saved: SavedService) {}

  /** La liste complète, telle qu'affichée dans l'espace locataire. */
  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.saved.list(user.id);
  }

  /** Les seules références, pour marquer les cartes d'une page de résultats. */
  @Get('references')
  references(@CurrentUser() user: PublicUser) {
    return this.saved.references(user.id);
  }

  /** `PUT` et non `POST` : sauvegarder est idempotent, comme l'est la méthode. */
  @Put(':reference')
  @HttpCode(200)
  save(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.saved.save(user.id, reference);
  }

  @Delete(':reference')
  @HttpCode(200)
  unsave(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.saved.unsave(user.id, reference);
  }
}
