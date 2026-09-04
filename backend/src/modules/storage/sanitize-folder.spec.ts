import { sanitizeFolder } from './storage.keys';

/**
 * Assainissement du dossier de destination.
 *
 * C'est ce qui empêche qu'un dossier calculé à partir d'une donnée utilisateur
 * ne devienne une traversée de répertoire ou, pire, un franchissement de la
 * frontière entre public et privé. La règle est volontairement restrictive :
 * mieux vaut refuser un nom exotique que laisser passer une clé forgée.
 */
describe('sanitizeFolder', () => {
  it('laisse intact un chemin déjà propre', () => {
    expect(sanitizeFolder('properties/mz-0142/diagnostics')).toBe(
      'properties/mz-0142/diagnostics',
    );
  });

  it('met en minuscules', () => {
    // Les clés doivent être stables : deux casses différentes désigneraient
    // deux dossiers sur un système de fichiers sensible à la casse.
    expect(sanitizeFolder('Properties/MZ-0142')).toBe('properties/mz-0142');
  });

  it('neutralise les séquences de traversée', () => {
    // Le point ne figure pas dans la liste blanche : il devient un tiret, et
    // `..` cesse de désigner le dossier parent.
    expect(sanitizeFolder('../../etc')).not.toContain('..');
    expect(sanitizeFolder('properties/../private')).not.toContain('..');
    // Et surtout : la frontière entre régimes ne se franchit pas.
    expect(sanitizeFolder('../private/tenants')).toBe('--/private/tenants');
  });

  it('remplace tout caractère hors alphabet autorisé', () => {
    expect(sanitizeFolder('properties/mz 0142; rm -rf')).toMatch(/^[a-z0-9/-]+$/);
  });

  it('réduit les barres consécutives et retire celles des extrémités', () => {
    expect(sanitizeFolder('//properties///mz-0142//')).toBe('properties/mz-0142');
  });

  it.each([
    ['une chaîne vide', ''],
    ['des points seuls', '...'],
    ['des barres seules', '///'],
    ['des tirets seuls', '---'],
    ['de la ponctuation seule', '!?@'],
  ])('refuse %s plutôt que de deviner une destination', (_label, entree) => {
    // Un chemin sans le moindre caractère alphanumérique est le signe que
    // l'appelant a calculé sa destination à partir de rien.
    //
    // `null` et non une exception : une fonction pure n'a pas à décider d'un
    // code HTTP. C'est l'appelant qui traduit en 400.
    expect(sanitizeFolder(entree)).toBeNull();
  });

  it('ne produit jamais de chemin absolu', () => {
    // Un chemin absolu résolu contre la racine du régime sortirait de cette
    // racine sur la plupart des implémentations.
    expect(sanitizeFolder('/etc/passwd')?.startsWith('/')).toBe(false);
  });
});
