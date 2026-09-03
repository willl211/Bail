import { DocumentType, EmploymentContractType, GuarantorKind } from '@prisma/client';

/**
 * Regroupement d'affichage. Il porte aussi le statut synthétique montré au
 * locataire (« Identité validée », « Revenus validés ») et, plus tard, ce que
 * la candidature transmettra au propriétaire.
 */
export type DocumentGroup = 'identity' | 'income' | 'housing' | 'guarantor';

export interface DocumentSlot {
  type: DocumentType;
  label: string;
  hint: string;
  group: DocumentGroup;
  /** Nombre de fichiers acceptés sur cette ligne. */
  max: number;
}

/**
 * Pièces attendues d'un dossier locataire.
 *
 * `PASSPORT` n'a pas de ligne propre : passeport et titre de séjour se déposent
 * sur la ligne « Pièce d'identité », comme dans la maquette. Multiplier les
 * lignes pour un même besoin ferait croire à trois pièces à fournir.
 */
export const SLOTS: DocumentSlot[] = [
  {
    type: DocumentType.ID_CARD,
    label: 'Pièce d’identité',
    hint: 'CNI, passeport ou titre de séjour en cours de validité.',
    group: 'identity',
    max: 1,
  },
  {
    type: DocumentType.PAYSLIP,
    label: 'Bulletins de salaire',
    hint: 'Les trois derniers mois.',
    group: 'income',
    max: 3,
  },
  {
    type: DocumentType.EMPLOYMENT_CONTRACT,
    label: 'Contrat de travail',
    hint: 'Ou attestation d’employeur de moins de trois mois.',
    group: 'income',
    max: 1,
  },
  {
    type: DocumentType.STUDENT_CARD,
    label: 'Certificat de scolarité',
    hint: 'Carte étudiante ou certificat de l’année en cours.',
    group: 'income',
    max: 1,
  },
  {
    type: DocumentType.TAX_NOTICE,
    label: 'Avis d’imposition',
    hint: 'Le plus récent. Les trois premières pages suffisent.',
    group: 'income',
    max: 1,
  },
  {
    type: DocumentType.PROOF_OF_ADDRESS,
    label: 'Justificatif de domicile',
    hint: 'Quittance de loyer ou facture d’énergie de moins de trois mois.',
    group: 'housing',
    max: 1,
  },
  {
    type: DocumentType.GUARANTOR_ID,
    label: 'Pièce d’identité du garant',
    hint: 'Même exigence que pour la vôtre.',
    group: 'guarantor',
    max: 1,
  },
  {
    type: DocumentType.GUARANTOR_INCOME,
    label: 'Revenus du garant',
    hint: 'Avis d’imposition ou trois bulletins de salaire.',
    group: 'guarantor',
    max: 1,
  },
];

export const SLOT_BY_TYPE = new Map(SLOTS.map((slot) => [slot.type, slot]));

/**
 * Pièces réellement exigées, selon la situation déclarée.
 *
 * Un étudiant n'a ni bulletins de salaire ni contrat de travail : les lui
 * réclamer bloquerait un dossier parfaitement valide — et les étudiants sont
 * une part importante du marché messin (docs/market-context.md). Un
 * indépendant n'a pas de bulletins non plus ; son avis d'imposition fait foi.
 */
export function requiredTypes(
  contractType: EmploymentContractType | null,
  guarantorKind: GuarantorKind | null,
): DocumentType[] {
  const required: DocumentType[] = [DocumentType.ID_CARD, DocumentType.PROOF_OF_ADDRESS];

  switch (contractType) {
    case EmploymentContractType.STUDENT:
      required.push(DocumentType.STUDENT_CARD);
      break;
    case EmploymentContractType.SELF_EMPLOYED:
      required.push(DocumentType.TAX_NOTICE);
      break;
    case EmploymentContractType.RETIRED:
      required.push(DocumentType.TAX_NOTICE);
      break;
    case null:
      // Situation non renseignée : on n'exige que le socle commun, et le
      // dossier reste marqué incomplet par ailleurs.
      break;
    default:
      required.push(
        DocumentType.PAYSLIP,
        DocumentType.EMPLOYMENT_CONTRACT,
        DocumentType.TAX_NOTICE,
      );
  }

  // Un organisme de cautionnement n'a pas de pièce d'identité : lui en
  // réclamer une rendrait le dossier impossible à compléter. Sa garantie tient
  // dans une attestation, déposée sur la ligne « Revenus du garant ».
  if (guarantorKind === GuarantorKind.INDIVIDUAL) {
    required.push(DocumentType.GUARANTOR_ID, DocumentType.GUARANTOR_INCOME);
  } else if (guarantorKind === GuarantorKind.ORGANISATION) {
    required.push(DocumentType.GUARANTOR_INCOME);
  }

  return required;
}

/**
 * Libellés des lignes du garant selon son type.
 *
 * « Pièce d'identité du garant » et « Revenus du garant » ne veulent rien dire
 * pour Visale ou une caution bancaire : c'est une attestation de garantie
 * qu'on leur demande.
 */
export function guarantorSlotLabel(
  type: DocumentType,
  kind: GuarantorKind,
): { label: string; hint: string } | null {
  if (kind !== GuarantorKind.ORGANISATION) return null;

  if (type === DocumentType.GUARANTOR_INCOME) {
    return {
      label: 'Attestation de garantie',
      hint: 'Visale, caution bancaire ou garantie employeur, en cours de validité.',
    };
  }
  return null;
}
