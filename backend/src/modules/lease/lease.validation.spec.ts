import { LeaseType } from '@prisma/client';
import { validateLease, type LeaseValidationInput } from './lease.validation';

/**
 * Contrôle de cohérence du bail.
 *
 * C'est le code le plus lourd de conséquences du projet : il décide si un acte
 * peut partir en signature. CLAUDE.md règle 2 impose qu'il soit déterministe —
 * une comparaison ne se trompe pas, un modèle de langage si — et ces tests sont
 * ce qui rend cette promesse vérifiable plutôt qu'affirmée.
 *
 * Les plafonds testés ici sont ceux de la loi n° 89-462 du 6 juillet 1989. Ils
 * sont en dur dans le code, volontairement : les mettre en base laisserait
 * croire qu'on peut les relever. Ces tests sont donc aussi le garde-fou qui
 * signalerait une tentative de les changer.
 */

/** Un dossier entièrement conforme, dont chaque test dérive son cas. */
function conformingInput(overrides: Partial<LeaseValidationInput> = {}): LeaseValidationInput {
  const base: LeaseValidationInput = {
    leaseType: LeaseType.NU,
    fieldValues: {
      titreContrat: 'Contrat de location — logement vide',
      bailleurNomComplet: 'Sylvie Kremer',
      bailleurAdresse: '3 rue des Clercs, 57000 Metz',
      locataireNomComplet: 'Camille Ferry',
      logementSurfaceM2: 68,
    },
    fieldSchema: {
      titreContrat: { type: 'string', required: true },
      bailleurNomComplet: { type: 'string', required: true },
      bailleurAdresse: { type: 'string', required: true },
      locataireNomComplet: { type: 'string', required: true },
      logementSurfaceM2: { type: 'number', required: true, min: 9 },
    },
    property: {
      reference: 'MZ-0155',
      leaseType: LeaseType.NU,
      surfaceM2: 68,
      rooms: 3,
      rentCents: 88_000,
      chargesCents: 8_500,
      depositCents: 88_000,
      energyRating: 'C',
      hasEnergyDocument: true,
    },
    landlord: { fullName: 'Sylvie Kremer' },
    tenant: { fullName: 'Camille Ferry', identityVerified: true },
    lease: {
      rentCents: 88_000,
      chargesCents: 8_500,
      depositCents: 88_000,
      durationMonths: 36,
    },
    templateChecksum: 'abc123def456',
    storedChecksum: 'abc123def456',
  };
  return { ...base, ...overrides };
}

const statusOf = (report: ReturnType<typeof validateLease>, key: string) =>
  report.checks.find((check) => check.key === key)?.status;

describe('validateLease', () => {
  it('déclare conforme un bail dont tout concorde', () => {
    const report = validateLease(conformingInput());

    expect(report.anomalies).toEqual([]);
    expect(report.unverifiable).toEqual([]);
    expect(report.checks).toHaveLength(8);
    expect(report.checks.every((check) => check.status === 'CONFORME')).toBe(true);
  });

  describe('intégrité du modèle', () => {
    it('refuse un modèle dont l’empreinte a changé depuis la publication', () => {
      const report = validateLease(
        conformingInput({ templateChecksum: 'autre-empreinte' }),
      );

      expect(statusOf(report, 'template')).toBe('ANOMALIE');
      expect(report.anomalies).toContain(
        'Le texte du modèle a changé depuis sa publication. Génération refusée.',
      );
    });
  });

  describe('dépôt de garantie', () => {
    // Loi n° 89-462, articles 22 et 25-6 : un mois de loyer HORS CHARGES en
    // location nue, deux en meublé.
    it('accepte un mois de loyer nu sur un bail nu', () => {
      const report = validateLease(
        conformingInput({ lease: { ...conformingInput().lease, depositCents: 88_000 } }),
      );
      expect(statusOf(report, 'deposit')).toBe('CONFORME');
    });

    it('refuse un euro de plus qu’un mois sur un bail nu', () => {
      const report = validateLease(
        conformingInput({ lease: { ...conformingInput().lease, depositCents: 88_100 } }),
      );
      expect(statusOf(report, 'deposit')).toBe('ANOMALIE');
      expect(report.anomalies).toContain('Le dépôt de garantie dépasse le plafond légal.');
    });

    it('accepte deux mois sur un bail meublé', () => {
      const meuble = conformingInput({
        leaseType: LeaseType.MEUBLE,
        property: { ...conformingInput().property, leaseType: LeaseType.MEUBLE },
        lease: {
          ...conformingInput().lease,
          depositCents: 176_000,
          durationMonths: 12,
        },
      });
      expect(statusOf(validateLease(meuble), 'deposit')).toBe('CONFORME');
    });

    it('refuse trois mois sur un bail meublé', () => {
      const meuble = conformingInput({
        leaseType: LeaseType.MEUBLE,
        property: { ...conformingInput().property, leaseType: LeaseType.MEUBLE },
        lease: {
          ...conformingInput().lease,
          depositCents: 264_000,
          durationMonths: 12,
        },
      });
      expect(statusOf(validateLease(meuble), 'deposit')).toBe('ANOMALIE');
    });

    it('calcule le plafond sur le loyer hors charges, pas charges comprises', () => {
      // 88 000 HC + 8 500 de charges. Un dépôt de 96 500 (le loyer CC) doit être
      // refusé : le plafond légal se calcule sur le loyer nu.
      const report = validateLease(
        conformingInput({ lease: { ...conformingInput().lease, depositCents: 96_500 } }),
      );
      expect(statusOf(report, 'deposit')).toBe('ANOMALIE');
    });
  });

  describe('durée', () => {
    it('exige 36 mois en location nue', () => {
      const report = validateLease(
        conformingInput({ lease: { ...conformingInput().lease, durationMonths: 12 } }),
      );
      expect(statusOf(report, 'duration')).toBe('ANOMALIE');
    });

    it('exige 12 mois en meublé', () => {
      const meuble = conformingInput({
        leaseType: LeaseType.MEUBLE,
        property: { ...conformingInput().property, leaseType: LeaseType.MEUBLE },
        lease: { ...conformingInput().lease, depositCents: 176_000, durationMonths: 36 },
      });
      expect(statusOf(validateLease(meuble), 'duration')).toBe('ANOMALIE');
    });
  });

  describe('loyer', () => {
    it('refuse un loyer différent de celui de l’annonce', () => {
      const report = validateLease(
        conformingInput({ lease: { ...conformingInput().lease, rentCents: 95_000 } }),
      );
      expect(statusOf(report, 'rent')).toBe('ANOMALIE');
      expect(report.anomalies.join(' ')).toContain('s’est engagé sur le montant de l’annonce');
    });

    it('refuse des charges différentes de celles de l’annonce', () => {
      const report = validateLease(
        conformingInput({ lease: { ...conformingInput().lease, chargesCents: 12_000 } }),
      );
      expect(statusOf(report, 'rent')).toBe('ANOMALIE');
    });
  });

  describe('type de bail', () => {
    it('refuse un modèle meublé sur un logement nu', () => {
      const report = validateLease(conformingInput({ leaseType: LeaseType.MEUBLE }));
      expect(statusOf(report, 'leaseType')).toBe('ANOMALIE');
    });
  });

  describe('surface', () => {
    it('ne se prononce pas sans DPE, plutôt que de valider à l’aveugle', () => {
      const report = validateLease(
        conformingInput({
          property: { ...conformingInput().property, hasEnergyDocument: false },
        }),
      );

      expect(statusOf(report, 'surface')).toBe('NON_VERIFIABLE');
      // Non vérifiable est bloquant, au même titre qu'une anomalie : on ne
      // signe pas un acte dont un élément n'a pu être recoupé avec rien.
      expect(report.unverifiable).toHaveLength(1);
      expect(report.anomalies).toEqual([]);
    });

    it('refuse une surface au bail différente de celle du bien', () => {
      const report = validateLease(
        conformingInput({
          fieldValues: { ...conformingInput().fieldValues, logementSurfaceM2: 75 },
        }),
      );
      expect(statusOf(report, 'surface')).toBe('ANOMALIE');
    });
  });

  describe('identités', () => {
    it('ne se prononce pas si la pièce d’identité n’est pas vérifiée', () => {
      const report = validateLease(
        conformingInput({
          tenant: { fullName: 'Camille Ferry', identityVerified: false },
        }),
      );
      expect(statusOf(report, 'identities')).toBe('NON_VERIFIABLE');
    });

    it('tolère la casse et les accents, qui ne sont pas des divergences d’identité', () => {
      const report = validateLease(
        conformingInput({
          fieldValues: {
            ...conformingInput().fieldValues,
            locataireNomComplet: '  CAMILLE  FERRY ',
          },
        }),
      );
      expect(statusOf(report, 'identities')).toBe('CONFORME');
    });

    it('refuse un nom réellement différent', () => {
      const report = validateLease(
        conformingInput({
          fieldValues: {
            ...conformingInput().fieldValues,
            locataireNomComplet: 'Camille Ferrier',
          },
        }),
      );
      expect(statusOf(report, 'identities')).toBe('ANOMALIE');
    });
  });

  describe('champs injectés', () => {
    it('signale un champ requis laissé vide, et le nomme', () => {
      const input = conformingInput();
      delete input.fieldValues.bailleurAdresse;

      const report = validateLease(input);

      expect(statusOf(report, 'fields')).toBe('ANOMALIE');
      expect(report.missingFields).toEqual(['bailleurAdresse']);
      expect(report.anomalies.join(' ')).toContain('bailleurAdresse');
    });

    it('traite une chaîne d’espaces comme un champ vide', () => {
      const report = validateLease(
        conformingInput({
          fieldValues: { ...conformingInput().fieldValues, bailleurAdresse: '   ' },
        }),
      );
      expect(report.missingFields).toEqual(['bailleurAdresse']);
    });

    it('refuse un champ absent du schéma du modèle', () => {
      const report = validateLease(
        conformingInput({
          fieldValues: {
            ...conformingInput().fieldValues,
            clauseMaison: 'Le locataire renonce à son droit de préemption.',
          },
        }),
      );

      expect(statusOf(report, 'fields')).toBe('ANOMALIE');
      expect(report.anomalies.join(' ')).toContain('clauseMaison');
    });
  });

  it('cumule les anomalies au lieu de s’arrêter à la première', () => {
    const report = validateLease(
      conformingInput({
        templateChecksum: 'altéré',
        lease: {
          rentCents: 95_000,
          chargesCents: 8_500,
          depositCents: 300_000,
          durationMonths: 24,
        },
      }),
    );

    // Modèle altéré, loyer, dépôt, durée : l'agent doit tout voir d'un coup,
    // pas corriger un point pour en découvrir un autre.
    expect(report.anomalies.length).toBeGreaterThanOrEqual(4);
  });
});
