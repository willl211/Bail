import { propertyChecks, type CheckableProperty } from './property.checks';

/**
 * Règle de publication d'une annonce.
 *
 * Fonction pure appelée à trois endroits — ce que voit le propriétaire, ce que
 * vérifie l'API à la soumission, ce que rejoue le back-office avant la mise en
 * ligne. Ces tests protègent la seule définition qu'il en existe : la dupliquer
 * serait le plus sûr moyen de publier un jour un bien sans DPE.
 */
function complete(overrides: Partial<CheckableProperty> = {}): CheckableProperty {
  return {
    energyRating: 'C',
    photos: new Array(6).fill({}),
    documents: [{ type: 'DPE' }],
    description:
      'Appartement de trois pièces au deuxième étage, proche des commerces et du Mettis.',
    title: '3 pièces, Sablon',
    addressLine: '14 rue de Verdun, 57000 Metz',
    surfaceM2: 68,
    rentCents: 88_000,
    ...overrides,
  };
}

describe('propertyChecks', () => {
  it('ne bloque ni ne signale rien sur un bien complet', () => {
    expect(propertyChecks(complete())).toEqual({ blockers: [], warnings: [] });
  });

  describe('diagnostics', () => {
    it('exige le fichier du DPE', () => {
      const { blockers } = propertyChecks(complete({ documents: [] }));
      expect(blockers).toContain('DPE manquant');
    });

    it('exige la classe affichée sur la fiche', () => {
      const { blockers } = propertyChecks(complete({ energyRating: null }));
      expect(blockers).toContain('Classe DPE manquante');
    });

    it('refuse la classe sans le fichier, et le fichier sans la classe', () => {
      // Deux exigences distinctes : l'une pour la fiche annonce, l'autre pour
      // pouvoir produire le diagnostic. Fournir l'une ne dispense pas de l'autre.
      expect(propertyChecks(complete({ documents: [] })).blockers).toHaveLength(1);
      expect(propertyChecks(complete({ energyRating: null })).blockers).toHaveLength(1);
    });

    it('ne se prononce pas quand les documents ne sont pas chargés', () => {
      // Certains appelants ne joignent pas les documents : absence d'information
      // n'est pas absence de document, et bloquer là-dessus refuserait un bien
      // parfaitement en règle.
      const { blockers } = propertyChecks(complete({ documents: undefined }));
      expect(blockers).toEqual([]);
    });
  });

  describe('champs obligatoires', () => {
    it.each([
      ['adresse', { addressLine: '   ' }, 'Adresse manquante'],
      ['surface', { surfaceM2: 0 }, 'Surface manquante'],
      ['loyer', { rentCents: 0 }, 'Loyer manquant'],
    ])('bloque sur %s', (_label, override, expected) => {
      const { blockers } = propertyChecks(complete(override as Partial<CheckableProperty>));
      expect(blockers).toContain(expected);
    });

    it('traite le titre par défaut comme une absence de titre', () => {
      // « Nouveau bien » est le nom que porte un brouillon fraîchement créé :
      // le laisser tel quel n'est pas un choix éditorial.
      const { blockers } = propertyChecks(complete({ title: 'Nouveau bien' }));
      expect(blockers).toContain('Titre de l’annonce manquant');
    });

    it('refuse une surface ou un loyer négatifs', () => {
      expect(propertyChecks(complete({ surfaceM2: -5 })).blockers).toContain(
        'Surface manquante',
      );
      expect(propertyChecks(complete({ rentCents: -1 })).blockers).toContain(
        'Loyer manquant',
      );
    });
  });

  describe('avis non bloquants', () => {
    it('signale un nombre de photos insuffisant sans empêcher la publication', () => {
      // Refuser un bien complet parce qu'il n'a que cinq photos serait absurde.
      const { blockers, warnings } = propertyChecks(
        complete({ photos: new Array(5).fill({}) }),
      );

      expect(blockers).toEqual([]);
      expect(warnings).toContain('Photos (5 / 6)');
    });

    it('signale une description trop courte', () => {
      const { blockers, warnings } = propertyChecks(complete({ description: 'Joli T3.' }));
      expect(blockers).toEqual([]);
      expect(warnings).toContain('Description courte');
    });
  });

  it('cumule les blocages plutôt que de s’arrêter au premier', () => {
    const { blockers } = propertyChecks({
      energyRating: null,
      photos: [],
      documents: [],
      description: '',
      title: '',
      addressLine: '',
      surfaceM2: 0,
      rentCents: 0,
    });

    expect(blockers).toHaveLength(6);
  });
});
