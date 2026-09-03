import { Injectable, Logger } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import type {
  VerificationDriver,
  VerificationOutcome,
  VerificationRequest,
} from './verification.driver';

/**
 * Prestataire de vérification simulé.
 *
 * Aucun prestataire KYC n'est retenu (docs/integrations.md) : ce driver tient
 * la place, et l'interface l'annonce à l'écran — le locataire voit
 * « prestataire simulé », jamais un « vérifié » qui laisserait croire qu'un
 * contrôle réel a eu lieu. Poser un badge vert sur une pièce d'identité que
 * personne n'a regardée serait exactement l'habitude à ne pas prendre.
 *
 * Ce que le mock reproduit fidèlement, en revanche, c'est la **répartition**
 * des verdicts d'un vrai prestataire : les pièces à structure normalisée
 * (identité, bulletins, contrat, avis d'imposition) se contrôlent
 * automatiquement ; un justificatif de domicile, non — c'est un document
 * hétérogène dont l'adresse se lit à l'œil. Un mock qui validerait tout
 * masquerait l'existence même du contrôle manuel.
 */
@Injectable()
export class MockVerificationDriver implements VerificationDriver {
  readonly name = 'mock';

  private readonly logger = new Logger(MockVerificationDriver.name);

  /** Note produite par le contrôle automatique, par type de pièce. */
  private static readonly NOTES: Partial<Record<DocumentType, string>> = {
    [DocumentType.ID_CARD]: 'Lecture MRZ · nom, date de naissance et validité recoupés',
    [DocumentType.PASSPORT]: 'Lecture MRZ · nom, date de naissance et validité recoupés',
    [DocumentType.PAYSLIP]: 'Employeur et net imposable cohérents',
    [DocumentType.EMPLOYMENT_CONTRACT]: 'Nature du contrat et employeur confirmés',
    [DocumentType.TAX_NOTICE]: 'Numéro fiscal et revenu de référence cohérents',
    [DocumentType.STUDENT_CARD]: 'Établissement et année universitaire confirmés',
    [DocumentType.GUARANTOR_ID]: 'Lecture MRZ · identité du garant recoupée',
    [DocumentType.GUARANTOR_INCOME]: 'Revenus du garant cohérents avec la pièce fournie',
  };

  /**
   * Pièces qu'aucun contrôle automatique ne tranche : elles partent en revue
   * humaine. Le back-office (écran à construire) portera cette revue.
   */
  private static readonly MANUAL: DocumentType[] = [
    DocumentType.PROOF_OF_ADDRESS,
    DocumentType.OTHER,
  ];

  async verify(request: VerificationRequest): Promise<VerificationOutcome> {
    if (MockVerificationDriver.MANUAL.includes(request.type)) {
      this.logger.log(`[mock] ${request.type} → revue manuelle (${request.documentId})`);
      return {
        status: 'manual',
        note: 'Lecture automatique impossible sur ce type de pièce · contrôle par un agent Bail',
      };
    }

    const note = MockVerificationDriver.NOTES[request.type];
    if (!note) {
      // Un type sans règle ne doit pas passer par défaut : c'est en revue
      // humaine qu'il finit, pas en « vérifié ».
      this.logger.warn(
        `[mock] aucun contrôle défini pour ${request.type} → revue manuelle`,
      );
      return {
        status: 'manual',
        note: 'Type de pièce non reconnu · contrôle par un agent Bail',
      };
    }

    this.logger.log(`[mock] ${request.type} → vérifié (${request.documentId})`);
    return { status: 'verified', note };
  }
}
