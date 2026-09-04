import { DocumentType, EmploymentContractType, GuarantorKind } from '@prisma/client';
import { guarantorSlotLabel, requiredTypes } from './tenant.slots';

/**
 * Pièces exigées d'un dossier locataire.
 *
 * Cette liste décide si un dossier est « complet » — donc s'il peut être
 * vérifié, donc s'il peut candidater. Réclamer une pièce qui n'existe pas pour
 * une situation donnée bloque un dossier parfaitement valide ; en oublier une
 * laisse passer un dossier creux.
 */
describe('requiredTypes', () => {
  it('exige toujours identité et domicile', () => {
    expect(requiredTypes(null, null)).toEqual([
      DocumentType.ID_CARD,
      DocumentType.PROOF_OF_ADDRESS,
    ]);
  });

  it('demande bulletins, contrat et avis d’imposition à un salarié', () => {
    expect(requiredTypes(EmploymentContractType.CDI, null)).toEqual(
      expect.arrayContaining([
        DocumentType.PAYSLIP,
        DocumentType.EMPLOYMENT_CONTRACT,
        DocumentType.TAX_NOTICE,
      ]),
    );
  });

  it('ne réclame pas de bulletin de salaire à un étudiant', () => {
    // Les étudiants sont une part importante du marché messin : leur demander
    // un bulletin de salaire bloquerait un dossier parfaitement valide.
    const required = requiredTypes(EmploymentContractType.STUDENT, null);

    expect(required).toContain(DocumentType.STUDENT_CARD);
    expect(required).not.toContain(DocumentType.PAYSLIP);
    expect(required).not.toContain(DocumentType.EMPLOYMENT_CONTRACT);
  });

  it.each([EmploymentContractType.SELF_EMPLOYED, EmploymentContractType.RETIRED])(
    'se contente de l’avis d’imposition pour %s',
    (contractType) => {
      const required = requiredTypes(contractType, null);
      expect(required).toContain(DocumentType.TAX_NOTICE);
      expect(required).not.toContain(DocumentType.PAYSLIP);
    },
  );

  describe('garant', () => {
    it('exige identité et revenus d’un garant personne physique', () => {
      const required = requiredTypes(EmploymentContractType.CDI, GuarantorKind.INDIVIDUAL);
      expect(required).toContain(DocumentType.GUARANTOR_ID);
      expect(required).toContain(DocumentType.GUARANTOR_INCOME);
    });

    it('ne réclame pas de pièce d’identité à un organisme de cautionnement', () => {
      // Visale n'a pas de carte d'identité : la lui demander rendrait le
      // dossier impossible à compléter.
      const required = requiredTypes(
        EmploymentContractType.STUDENT,
        GuarantorKind.ORGANISATION,
      );

      expect(required).toContain(DocumentType.GUARANTOR_INCOME);
      expect(required).not.toContain(DocumentType.GUARANTOR_ID);
    });

    it('n’ajoute rien sans garant déclaré', () => {
      const sans = requiredTypes(EmploymentContractType.CDI, null);
      expect(sans.filter((type) => type.startsWith('GUARANTOR'))).toEqual([]);
    });
  });

  it('ne renvoie jamais de doublon', () => {
    for (const contractType of Object.values(EmploymentContractType)) {
      for (const kind of [null, ...Object.values(GuarantorKind)]) {
        const required = requiredTypes(contractType, kind);
        expect(new Set(required).size).toBe(required.length);
      }
    }
  });
});

describe('guarantorSlotLabel', () => {
  it('renomme la ligne « revenus » en attestation pour un organisme', () => {
    // « Revenus du garant » ne veut rien dire pour Visale ou une caution
    // bancaire : c'est une attestation qu'on leur demande.
    expect(guarantorSlotLabel(DocumentType.GUARANTOR_INCOME, GuarantorKind.ORGANISATION))
      .toMatchObject({ label: 'Attestation de garantie' });
  });

  it('laisse les libellés d’origine pour une personne physique', () => {
    expect(
      guarantorSlotLabel(DocumentType.GUARANTOR_INCOME, GuarantorKind.INDIVIDUAL),
    ).toBeNull();
  });
});
