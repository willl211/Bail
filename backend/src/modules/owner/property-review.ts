import { ConflictException } from '@nestjs/common';
import type { Prisma, Property, PropertyReviewEvent } from '@prisma/client';
import type { FileActor } from '../tenant/tenant-file.revision';

export const PROPERTY_CHANGED =
  'Ce bien a changé depuis son chargement. Actualisez la page avant de poursuivre.';

/** Verrou commun aux modifications du propriétaire et aux décisions des agents. */
export async function advancePropertyRevision(
  tx: Prisma.TransactionClient,
  property: Pick<Property, 'id' | 'reviewRevision' | 'status'>,
  data: Prisma.PropertyUpdateManyMutationInput = {},
) {
  const result = await tx.property.updateMany({
    where: { id: property.id, reviewRevision: property.reviewRevision, status: property.status },
    data: { ...data, reviewRevision: { increment: 1 } },
  });
  if (result.count !== 1) throw new ConflictException(PROPERTY_CHANGED);
  return property.reviewRevision + 1;
}

export function recordPropertyEvent(
  tx: Prisma.TransactionClient,
  propertyId: string,
  revision: number,
  actor: FileActor,
  event: { action: string; title: string; note: string; snapshot?: Prisma.InputJsonValue },
) {
  return tx.propertyReviewEvent.create({
    data: { propertyId, revision, actorId: actor.id, actorLabel: actor.label, ...event },
  });
}

export function propertyEventView(event: PropertyReviewEvent) {
  return {
    at: event.createdAt.toISOString(),
    tone: (event.action.endsWith('REJECTED')
      ? 'reject'
      : event.action.endsWith('VERIFIED') || event.action === 'PROPERTY_PUBLISHED'
        ? 'ok'
        : 'neutral') as 'reject' | 'ok' | 'neutral',
    title: event.title,
    note: `${event.note} · ${event.actorLabel} · Version ${event.revision}`,
  };
}
