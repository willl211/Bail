import { Controller, Get } from '@nestjs/common';
import { MarketService } from './market.service';

@Controller('market')
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
