import {
  DocumentStatus,
  DocumentType,
  EmploymentContractType,
  TenantFileStatus,
} from '@prisma/client';
import {
  aggregateDocumentStatus,
  isCurrentVerification,
  requiredDocumentChecks,
  verificationBlockers,
} from './tenant-file.policy';

const ready = () => ({
  contractType: EmploymentContractType.CDI,
  netMonthlyIncomeCents: 200_000,
  guarantors: [],
  documents: [
    DocumentType.ID_CARD,
    DocumentType.PROOF_OF_ADDRESS,
    DocumentType.PAYSLIP,
    DocumentType.EMPLOYMENT_CONTRACT,
    DocumentType.TAX_NOTICE,
  ].map((type): { type: DocumentType; status: DocumentStatus } => ({
    type,
    status: DocumentStatus.VERIFIED,
  })),
});

describe('règles communes de validation du dossier', () => {
  it.each([
    DocumentStatus.REJECTED,
    DocumentStatus.EXPIRED,
    DocumentStatus.PROCESSING,
    DocumentStatus.PENDING,
  ])('un second bulletin %s empêche la validation malgré le premier vérifié', (status) => {
    const file = ready();
    file.documents.push({ type: DocumentType.PAYSLIP, status });
    expect(verificationBlockers(file)).toEqual(['Bulletins de salaire']);
    expect(requiredDocumentChecks(file).filter((slot) => slot.status === 'VERIFIED')).toHaveLength(
      4,
    );
  });

  it('accepte un passeport sur la ligne d’identité, avec la même règle que la CNI', () => {
    const file = ready();
    file.documents[0].type = DocumentType.PASSPORT;
    expect(verificationBlockers(file)).toEqual([]);
  });

  it('ne confond pas zéro revenu avec un revenu non renseigné', () => {
    expect(verificationBlockers({ ...ready(), netMonthlyIncomeCents: 0 })).toEqual([]);
    expect(verificationBlockers({ ...ready(), netMonthlyIncomeCents: null })).toContain(
      'Revenus mensuels — à renseigner',
    );
  });

  it('ne considère jamais un groupe vide comme vérifié', () => {
    expect(aggregateDocumentStatus([])).toBe('MISSING');
    expect(aggregateDocumentStatus([{ status: DocumentStatus.MISSING }])).toBe('MISSING');
  });

  it('n’étend pas une validation à une version différente', () => {
    const file = {
      ...ready(),
      status: TenantFileStatus.VERIFIED,
      revision: 4,
      verifiedRevision: 3,
    };
    expect(isCurrentVerification(file)).toBe(false);
    expect(isCurrentVerification({ ...file, verifiedRevision: 4 })).toBe(true);
    expect(isCurrentVerification({ ...file, verifiedRevision: null })).toBe(false);
  });
});
