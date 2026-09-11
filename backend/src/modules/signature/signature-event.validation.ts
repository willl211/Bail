import { BadRequestException } from '@nestjs/common';
import { LEASE_SIGNERS, SIGNATURE_EVENT_TYPES } from '../lease/lease-signature.policy';
import type { SignatureEvent } from './signature.driver';

export function validateSignatureEvent(event: SignatureEvent): void {
  const identifier = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
  if (!event || !identifier(event.id) || !identifier(event.envelopeId))
    throw new BadRequestException('Identifiants de notification et d’enveloppe obligatoires.');
  if (!SIGNATURE_EVENT_TYPES.includes(event.type))
    throw new BadRequestException('Type de notification inconnu.');
  if (!(event.occurredAt instanceof Date) || !Number.isFinite(event.occurredAt.getTime()))
    throw new BadRequestException('Horodatage de notification invalide.');
  if (event.signerId !== null && !LEASE_SIGNERS.some((role) => role === event.signerId))
    throw new BadRequestException('Signataire inconnu pour ce bail.');
  if (event.type === 'signed' && event.signerId === null)
    throw new BadRequestException('Une signature doit identifier le bailleur ou le locataire.');
  if (event.reason !== null && (typeof event.reason !== 'string' || event.reason.length > 1000))
    throw new BadRequestException('Motif de notification invalide.');
}
