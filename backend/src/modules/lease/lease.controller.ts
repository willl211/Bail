import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import type { PublicUser } from '../auth/auth.service';
import { CurrentUser, Public, Roles } from '../auth/session.guard';
import { LeaseService } from './lease.service';

/**
 * Bail et signature électronique — écran 6 du build-order.
 *
 * Accessible aux trois profils, mais chacun ne voit que ce qui le concerne :
 * le filtrage se fait dans le service, sur l'identité du demandeur.
 */
@Controller('leases')
@Roles(UserRole.OWNER, UserRole.TENANT, UserRole.AGENT)
export class LeaseController {
  constructor(private readonly leases: LeaseService) {}

  /** Mes baux — ceux de mes biens si je suis propriétaire, les miens sinon. */
  @Get()
  listMine(@CurrentUser() user: PublicUser) {
    if (user.role === UserRole.AGENT) return [];
    return this.leases.listFor(user.id, user.role === UserRole.OWNER ? 'OWNER' : 'TENANT');
  }

  @Get(':reference')
  read(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.leases.getByReference(reference, user.id, user.role);
  }

  /** Envoie le bail aux signataires. Réservé au propriétaire du bien. */
  @Post(':reference/send')
  @HttpCode(200)
  @Roles(UserRole.OWNER)
  send(@CurrentUser() user: PublicUser, @Param('reference') reference: string) {
    return this.leases.sendForSignature(reference, user.id);
  }
}

/**
 * Notifications du prestataire de signature.
 *
 * Route publique — appelée par le prestataire, pas par un navigateur porteur de
 * session. C'est la signature de la charge qui l'authentifie, rien d'autre :
 * sans elle, n'importe qui pourrait déclarer un bail signé.
 */
@Controller('leases/signature/webhook')
@Public()
export class LeaseSignatureWebhookController {
  constructor(private readonly leases: LeaseService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-signature') signature?: string,
  ) {
    const payload = request.rawBody;
    if (!payload) {
      throw new BadRequestException('Charge brute absente : signature invérifiable.');
    }

    const event = this.leases.parseSignatureEvent(payload, signature);
    const handled = await this.leases.applySignatureEvent(event);
    return { received: true, handled };
  }
}
