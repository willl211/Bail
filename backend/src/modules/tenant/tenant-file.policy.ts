import {
  DocumentStatus,
  DocumentType,
  TenantFileStatus,
  type EmploymentContractType,
  type Guarantor,
  type GuarantorKind,
  type TenantDocument,
  type TenantFile,
} from '@prisma/client';
import { SLOT_BY_TYPE, guarantorSlotLabel, requiredTypes } from './tenant.slots';

type DocumentState = { type: DocumentType; status: DocumentStatus };
type CheckableFile = {
  contractType: EmploymentContractType | null;
  netMonthlyIncomeCents: number | null;
  documents: DocumentState[];
  guarantors: { kind: GuarantorKind }[];
};

export function aggregateDocumentStatus(
  documents: { status: DocumentStatus }[],
): DocumentStatus | 'MISSING' {
  if (documents.length === 0) return 'MISSING';
  for (const status of [
    DocumentStatus.REJECTED,
    DocumentStatus.EXPIRED,
    DocumentStatus.MISSING,
    DocumentStatus.PROCESSING,
    DocumentStatus.PENDING,
  ]) {
    if (documents.some((document) => document.status === status)) return status;
  }
  return DocumentStatus.VERIFIED;
}

export function documentsForType<T extends DocumentState>(documents: T[], type: DocumentType): T[] {
  return documents.filter(
    (document) =>
      document.type === type ||
      (type === DocumentType.ID_CARD && document.type === DocumentType.PASSPORT),
  );
}

export function requiredDocumentChecks(file: CheckableFile) {
  const kind = file.guarantors[0]?.kind ?? null;
  return requiredTypes(file.contractType, kind).map((type) => ({
    type,
    label: (kind ? guarantorSlotLabel(type, kind)?.label : null) ?? SLOT_BY_TYPE.get(type)!.label,
    status: aggregateDocumentStatus(documentsForType(file.documents, type)),
  }));
}

export function profileMissing(
  file: Pick<CheckableFile, 'contractType' | 'netMonthlyIncomeCents'>,
): string[] {
  return [
    ...(file.contractType === null ? ['Situation professionnelle — à renseigner'] : []),
    ...(file.netMonthlyIncomeCents === null ? ['Revenus mensuels — à renseigner'] : []),
  ];
}

/** La même règle sert à l'affichage admin et à la décision côté serveur. */
export function verificationBlockers(file: CheckableFile): string[] {
  return [
    ...profileMissing(file),
    ...requiredDocumentChecks(file)
      .filter((slot) => slot.status !== DocumentStatus.VERIFIED)
      .map((slot) => slot.label),
  ];
}

export function isCurrentVerification(
  file: CheckableFile & Pick<TenantFile, 'status' | 'revision' | 'verifiedRevision'>,
): boolean {
  return (
    file.status === TenantFileStatus.VERIFIED &&
    file.verifiedRevision === file.revision &&
    verificationBlockers(file).length === 0
  );
}

export function verificationSnapshot(
  file: TenantFile & { documents: TenantDocument[]; guarantors: Guarantor[] },
) {
  return {
    profile: {
      contractType: file.contractType,
      netMonthlyIncomeCents: file.netMonthlyIncomeCents,
      employerName: file.employerName,
      inProbationPeriod: file.inProbationPeriod,
    },
    guarantors: file.guarantors.map((guarantor) => ({
      id: guarantor.id,
      kind: guarantor.kind,
      firstName: guarantor.firstName,
      lastName: guarantor.lastName,
      organisationName: guarantor.organisationName,
      relationship: guarantor.relationship,
      contractType: guarantor.contractType,
      netMonthlyIncomeCents: guarantor.netMonthlyIncomeCents,
    })),
    documents: file.documents.map((document) => ({
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      status: document.status,
      verifiedAt: document.verifiedAt?.toISOString() ?? null,
      updatedAt: document.updatedAt.toISOString(),
    })),
  };
}
