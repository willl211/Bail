import * as fmt from './format';

/**
 * Formats d'affichage.
 *
 * Ces fonctions produisent tout ce que l'utilisateur lit de chiffré : un loyer,
 * une surface, une échéance. Une erreur d'arrondi ou de séparateur y est
 * invisible en relecture mais visible sur chaque écran — et un loyer mal
 * formaté sur une fiche annonce n'est pas un détail cosmétique.
 *
 * Les fonctions dépendant du fuseau sont testées avec une date construite en
 * heure locale, pour que la campagne donne le même résultat partout.
 */
describe('montants', () => {
  it('arrondit à l’euro pour l’affichage courant', () => {
    // Les montants circulent en centimes côté API : l'oubli de la conversion
    // afficherait 69 000 € au lieu de 690 €.
    expect(fmt.euros(69_000)).toBe('690 €');
    expect(fmt.euros(0)).toBe('0 €');
  });

  it('arrondit au plus proche, pas vers le bas', () => {
    expect(fmt.euros(69_050)).toBe('691 €');
    expect(fmt.euros(69_049)).toBe('690 €');
  });

  it('sépare les milliers', () => {
    // Espace insécable étroit, celui de la locale française.
    expect(fmt.euros(120_000)).toMatch(/^1\s?200 €$/);
  });

  it('garde les centimes quand le détail compte', () => {
    // Sur un décompte d'honoraires, l'arrondi masquerait des écarts.
    expect(fmt.eurosPrecise(54_400)).toBe('544,00 €');
    expect(fmt.eurosPrecise(54_449)).toBe('544,49 €');
  });
});

describe('surfaces et pièces', () => {
  it('formate une surface entière sans décimale parasite', () => {
    expect(fmt.surface(47)).toBe('47 M²');
    expect(fmt.surfaceLower(47)).toBe('47 m²');
  });

  it('n’affiche qu’une décimale sur une surface fractionnaire', () => {
    expect(fmt.surfaceLower(47.25)).toBe('47,3 m²');
  });

  it('accorde le mot « pièce »', () => {
    expect(fmt.rooms(1)).toBe('1 PIÈCE');
    expect(fmt.rooms(2)).toBe('2 PIÈCES');
  });

  it('affiche un tiret quand la classe DPE manque', () => {
    // Un brouillon n'en a pas encore ; « DPE » suivi d'un vide serait pire.
    expect(fmt.energyRating(null)).toBe('—');
    expect(fmt.energyRating('C')).toBe('C');
  });

  it('distingue les contextes mono et rédactionnel du meublé', () => {
    expect(fmt.furnished(true)).toBe('MEUBLÉ');
    expect(fmt.furnishedLabel(true)).toBe('Meublé');
    expect(fmt.furnished(false)).toBe('NU');
  });
});

describe('taux d’effort', () => {
  it('convertit un ratio en pourcentage entier', () => {
    expect(fmt.percent(0.324)).toBe('32 %');
    expect(fmt.percent(0.5)).toBe('50 %');
  });
});

describe('ancienneté', () => {
  const now = new Date('2026-09-10T12:00:00');
  const ago = (hours: number) =>
    new Date(now.getTime() - hours * 3_600_000).toISOString();

  it.each([
    ['moins d’une heure', 0.5, 'à l’instant'],
    ['quelques heures', 3, '3 h'],
    ['la veille', 30, 'hier'],
    ['quelques jours', 96, '4 jours'],
  ])('affiche %s', (_label, hours, expected) => {
    expect(fmt.relativeAge(ago(hours), now)).toBe(expected);
  });

  it('bascule sur une date au-delà d’une semaine', () => {
    // « 300 jours » ne dirait plus rien d'utile.
    expect(fmt.relativeAge(ago(24 * 30), now)).toMatch(/^\d{2}\.\d{2}$/);
  });

  it('passe de « hier » à « 2 jours » à la bonne frontière', () => {
    expect(fmt.relativeAge(ago(47), now)).toBe('hier');
    expect(fmt.relativeAge(ago(48), now)).toBe('2 jours');
  });
});

/**
 * Dates.
 *
 * Les instants sont écrits en UTC (« Z ») et attendus en heure de Paris : c'est
 * ce que l'API renvoie, et c'est la seule façon de vérifier le fuseau plutôt
 * que de le supposer. Des dates sans fuseau se seraient contentées de relire ce
 * que la machine de test avait déjà interprété — le test aurait passé partout
 * en ne prouvant rien.
 */
describe('dates', () => {
  it('écrit « 1er » pour le premier du mois', () => {
    // Le seul jour du mois qui prend une forme ordinale en français.
    expect(fmt.longDate('2026-10-01T08:00:00Z')).toBe('1er octobre 2026');
    expect(fmt.longDate('2026-10-02T08:00:00Z')).toBe('2 octobre 2026');
  });

  it('compose un horodatage de journal', () => {
    // 07:14 UTC = 09:14 à Paris, heure d'été.
    expect(fmt.logStamp('2026-09-02T07:14:00Z')).toBe('02.09 · 09:14');
  });

  it('compose un en-tête de colonne de calendrier', () => {
    // Le 8 septembre 2026 est un mardi ; l'abréviation perd son point.
    expect(fmt.dayHeading('2026-09-08T08:00:00Z')).toBe('mar 08.09');
  });

  it('compose un rendez-vous en toutes lettres', () => {
    expect(fmt.appointment('2026-09-10T16:30:00Z')).toBe('jeudi 10 septembre · 18:30');
  });

  it('complète les heures et minutes sur deux chiffres', () => {
    expect(fmt.timeOfDay('2026-09-10T07:05:00Z')).toBe('09:05');
  });

  it('rend l’heure de Paris, pas celle de la machine', () => {
    // Le rendu Next tourne en UTC en production. Sans fuseau épinglé, ce
    // rendez-vous s'afficherait « 22:30 » à l'écran et « 00:30 » dans l'e-mail
    // de confirmation, qui épingle Paris depuis toujours.
    expect(fmt.timeOfDay('2026-07-15T22:30:00Z')).toBe('00:30');
    // Et il tombe le lendemain : la date change avec l'heure.
    expect(fmt.appointment('2026-07-15T22:30:00Z')).toBe('jeudi 16 juillet · 00:30');
  });

  it('suit l’heure d’hiver', () => {
    // Décembre : Paris est à UTC+1, pas +2. Un décalage fixe se tromperait ici.
    expect(fmt.timeOfDay('2026-12-15T09:00:00Z')).toBe('10:00');
  });
});
