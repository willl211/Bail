import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { Public } from '../auth/session.guard';

/**
 * API publique des annonces.
 *
 * Écran 1 du build-order : « Recherche et fiche annonce (locataire) —
 * consultable sans compte ». Ces routes sont donc volontairement ouvertes et
 * ne renvoient aucune donnée nominative.
 */
@Controller('properties')
@Public()
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  search(@Query() query: SearchPropertiesDto) {
    return this.properties.search(query);
  }

  @Get('featured')
  featured(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.properties.findFeatured(limit ?? 3);
  }

  @Get(':reference')
  findOne(@Param('reference') reference: string) {
    return this.properties.findByReference(reference);
  }
}
