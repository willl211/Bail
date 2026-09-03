import { Controller, Get } from '@nestjs/common';
import { MarketService } from './market.service';
import { Public } from '../auth/session.guard';

/** Chiffres affichés sur l'accueil public. */
@Controller('market')
@Public()
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('snapshot')
  snapshot() {
    return this.market.getSnapshot();
  }

  @Get('owner-subscription')
  ownerSubscription() {
    return this.market.getOwnerSubscriptionPricing();
  }
}
