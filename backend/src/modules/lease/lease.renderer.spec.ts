import { renderPlainText, renderTemplate } from './lease.renderer';

/**
 * Rendu du modèle légal.
 *
 * La promesse de CLAUDE.md règle 2 — « la plateforme ne rédige aucune clause »
 * — repose entièrement sur ce fichier : il remplace des marqueurs et ne fait
 * rien d'autre. Ces tests vérifient les deux moitiés de la promesse : que le
 * texte du modèle traverse intact, et qu'aucun trou n'est comblé en douce.
 */
describe('renderTemplate', () => {
  it('remplace les marqueurs par les valeurs injectées', () => {
    const blocks = renderTemplate('Loyer : {{ loyer }} par mois', { loyer: '880,00 €' });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].segments.map((s) => s.text).join('')).toBe(
      'Loyer : 880,00 € par mois',
    );
  });

  it('distingue le texte du modèle des valeurs injectées', () => {
    // C'est ce qui permet à l'écran de surligner ce qui vient du dossier : la
    // promesse « aucune clause rédigée par la plateforme » doit être
    // vérifiable à l'œil, pas seulement affirmée.
    const [block] = renderTemplate('Bailleur : {{ nom }}', { nom: 'Sylvie Kremer' });

    expect(block.segments).toEqual([
      { text: 'Bailleur : ', field: null },
      { text: 'Sylvie Kremer', field: 'nom' },
    ]);
  });

  it('laisse un marqueur sans valeur visible en clair', () => {
    // Le supprimer produirait un acte au texte tronqué, bien plus difficile à
    // repérer qu'un marqueur resté apparent.
    const [block] = renderTemplate('Clause : {{ clausesLegales }}', {});
    const rendered = block.segments.map((s) => s.text).join('');

    expect(rendered).toBe('Clause : {{ clausesLegales }}');
    expect(block.segments.some((s) => s.field === 'clausesLegales')).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['chaîne vide', ''],
    ['espaces', '   '],
  ])('traite %s comme une valeur absente', (_label, value) => {
    const [block] = renderTemplate('X : {{ champ }}', { champ: value });
    expect(block.segments.map((s) => s.text).join('')).toBe('X : {{ champ }}');
  });

  it('accepte les marqueurs avec ou sans espaces', () => {
    const [block] = renderTemplate('{{champ}} et {{  champ  }}', { champ: 'ok' });
    expect(block.segments.map((s) => s.text).join('')).toBe('ok et ok');
  });

  it('reconnaît les niveaux de titre', () => {
    const blocks = renderTemplate('# Titre\n## Section\nParagraphe', {});
    expect(blocks.map((b) => b.heading)).toEqual([1, 2, 0]);
  });

  it('retire un commentaire HTML réparti sur plusieurs lignes', () => {
    // Un avertissement interne rédigé sur deux lignes verrait sinon sa seconde
    // ligne s'afficher au milieu de l'acte, sortie de son contexte.
    const body = [
      'Article 1',
      '<!-- TEXTE NON VALIDÉ JURIDIQUEMENT. Ce squelette ne contient aucune clause :',
      '     il attend le modèle fourni par l’avocat. -->',
      'Article 2',
    ].join('\n');

    const rendered = renderPlainText(body, {});

    expect(rendered).toContain('Article 1');
    expect(rendered).toContain('Article 2');
    expect(rendered).not.toContain('avocat');
    expect(rendered).not.toContain('-->');
  });

  it('n’ajoute rien au texte du modèle', () => {
    const body = '## 7. Clause résolutoire\n{{ clausesLegalesTexteValide }}';
    const rendered = renderPlainText(body, {
      clausesLegalesTexteValide: 'Texte fourni par l’avocat.',
    });

    expect(rendered).toBe('## 7. Clause résolutoire\nTexte fourni par l’avocat.');
  });

  it('écarte les lignes devenues vides', () => {
    const blocks = renderTemplate('A\n\n\nB', {});
    expect(blocks).toHaveLength(2);
  });
});
