/**
 * Tests des fonctions pures du front.
 *
 * Volontairement limité aux formats d'affichage : tout ce qu'ils produisent est
 * lu par l'utilisateur — un loyer, une surface, une échéance — et une erreur y
 * est invisible en relecture mais visible sur chaque écran.
 *
 * Pas de tests de rendu de composants pour l'instant : les écrans sont
 * essentiellement de la présentation, la logique vit dans l'API, et une
 * campagne de rendu coûterait plus à maintenir qu'elle ne rapporterait tant que
 * la maquette bouge encore.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/lib/**/*.spec.ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};
