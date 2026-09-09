import { ConflictException } from '@nestjs/common';
import { Prisma, TenantFileStatus, type TenantFile, type TenantFileEvent } from '@prisma/client';

export const FILE_CHANGED =
  'Ce dossier a changé depuis son chargement. Actualisez la page avant de poursuivre.';

/** Prend le verrou d'écriture avant de toucher au dossier ou à ses pièces. */
export async function advanceFileRevision(
  tx: Prisma.TransactionClient,
  file: Pick<TenantFile, 'id' | 'revision' | 'status'>,
  data: Prisma.TenantFileUpdateManyMutationInput = {},
) {
  const result = await tx.tenantFile.updateMany({
    where: { id: file.id, revision: file.revision, status: file.status },
    data: {
      status: file.status === TenantFileStatus.VERIFIED ? TenantFileStatus.SUBMITTED : file.status,
      verifiedAt: null,
      verifiedRevision: null,
      ...data,
      revision: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new ConflictException(FILE_CHANGED);
  return file.revision + 1;
}

export type FileActor = { id?: string; label: string };

export function recordFileEvent(
  tx: Prisma.TransactionClient,
  tenantFileId: string,
  revision: number,
  actor: FileActor,
  event: { action: string; title: string; note: string; snapshot?: Prisma.InputJsonValue },
) {
  return tx.tenantFileEvent.create({
    data: { tenantFileId, revision, actorId: actor.id, actorLabel: actor.label, ...event },
  });
}

export function fileEventView(event: TenantFileEvent) {
  return {
    at: event.createdAt.toISOString(),
    tone: (event.action.endsWith('REJECTED')
      ? 'reject'
      : event.action.endsWith('VERIFIED')
        ? 'ok'
        : 'neutral') as 'reject' | 'ok' | 'neutral',
    title: event.title,
    note: `${event.note} · ${event.actorLabel} · Version ${event.revision}`,
  };
}
