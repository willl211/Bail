import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { CurrentUser, Public } from '../auth/session.guard';
import type { PublicUser } from '../auth/auth.service';

/**
 * API publique des annonces.
 *
 * Écran 1 du build-order : « Recherche et fiche annonce (locataire) —
 * consultable sans compte ». Ces routes sont donc volontairement ouvertes et
 * ne renvoient aucune donnée nominative.
 *
 * La session est tout de même résolue par le garde, même ici : le classement
 * par compatibilité a besoin du dossier de celui qui regarde. Sans session, il
 * reçoit `null` et les annonces sortent par récence — la route ne se ferme pas
 * pour autant.
 */
@Controller('properties')
@Public()
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  search(@Query() query: SearchPropertiesDto, @CurrentUser() user: PublicUser | null) {
    return this.properties.search(query, user);
  }

  @Get('featured')
  featured(
    @CurrentUser() user: PublicUser | null,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.properties.findFeatured(limit ?? 3, user);
  }

  @Get(':reference')
  findOne(@Param('reference') reference: string) {
    return this.properties.findByReference(reference);
  }
}
