import { LeaseStatus } from '@prisma/client';

/** Identifiants effectivement envoyés au prestataire par sendForSignature. */
export const LEASE_SIGNERS = ['LANDLORD', 'TENANT'] as const;
export type LeaseSigner = (typeof LEASE_SIGNERS)[number];
export const SIGNATURE_EVENT_TYPES = [
  'sent',
  'delivered',
  'signed',
  'completed',
  'declined',
  'voided',
] as const;

export interface StoredSignatureEvent {
  id?: string;
  type: (typeof SIGNATURE_EVENT_TYPES)[number];
  signerId: string | null;
  occurredAt: string;
  reason?: string | null;
}

export function signatureEventsOf(value: unknown): StoredSignatureEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is StoredSignatureEvent => {
    if (!entry || typeof entry !== 'object') return false;
    const event = entry as Partial<StoredSignatureEvent>;
    return (
      SIGNATURE_EVENT_TYPES.includes(event.type!) &&
      typeof event.occurredAt === 'string' &&
      Number.isFinite(Date.parse(event.occurredAt)) &&
      (event.signerId == null || typeof event.signerId === 'string')
    );
  });
}

/** Les répétitions d'un même signataire ne changent ni le compteur ni sa première preuve. */
export function signatureProgress(value: unknown) {
  const events = signatureEventsOf(value);
  const signers = LEASE_SIGNERS.map((role) => {
    const event = events.find((entry) => entry.type === 'signed' && entry.signerId === role);
    return { role, signed: event !== undefined, signedAt: event?.occurredAt ?? null };
  });
  const count = signers.filter((signer) => signer.signed).length;
  const signedAt =
    count === LEASE_SIGNERS.length
      ? new Date(Math.max(...signers.map((signer) => Date.parse(signer.signedAt!))))
      : null;
  return { signers, count, signedAt };
}

export function acceptsSignatureEvents(status: LeaseStatus): boolean {
  return status === LeaseStatus.SENT_FOR_SIGNATURE || status === LeaseStatus.PARTIALLY_SIGNED;
}

export function nextSignatureStatus(
  events: StoredSignatureEvent[],
  event: StoredSignatureEvent,
): LeaseStatus {
  if (event.type === 'declined') return LeaseStatus.DECLINED;
  if (event.type === 'voided') return LeaseStatus.CANCELLED;
  const { count } = signatureProgress(events);
  if (count === LEASE_SIGNERS.length) return LeaseStatus.SIGNED;
  return count === 1 ? LeaseStatus.PARTIALLY_SIGNED : LeaseStatus.SENT_FOR_SIGNATURE;
}
