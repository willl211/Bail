/**
 * Deux campagnes côté front.
 *
 * `lib` teste les fonctions pures d'affichage — un loyer, une surface, une
 * échéance. Tout ce qu'elles produisent est lu par l'utilisateur, et une erreur
 * d'arrondi y est invisible en relecture mais visible sur chaque écran.
 *
 * `components` monte les écrans où vit une vraie logique client : ce qui se
 * désactive, ce qui se vide, ce qui part en réseau et ce qui ne doit surtout
 * pas y partir. Les écrans purement présentatifs n'y figurent pas — les tester
 * reviendrait à recopier leur JSX dans une assertion, ce qui coûte à maintenir
 * et ne protège de rien.
 *
 * Les modules d'appel à l'API sont doublés dans ces tests : ce qu'on vérifie
 * est *si* et *quand* le composant appelle, pas ce que l'API répond — c'est le
 * travail des tests d'intégration du backend.
 */
const common = {
  preset: 'ts-jest',
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};

module.exports = {
  projects: [
    {
      ...common,
      displayName: 'lib',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/lib/**/*.spec.ts'],
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
    },
    {
      ...common,
      displayName: 'components',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/components/**/*.spec.tsx'],
      setupFilesAfterEnv: ['<rootDir>/test/setup-components.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          { tsconfig: { jsx: 'react-jsx', esModuleInterop: true } },
        ],
      },
    },
  ],
};
