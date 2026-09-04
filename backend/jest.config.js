/**
 * Deux campagnes de tests, séparées par ce qu'elles exigent pour tourner.
 *
 * `unit` ne touche rien : que des fonctions pures — règles de publication,
 * contrôle de cohérence du bail, pièces exigées d'un dossier. Elles s'exécutent
 * partout, en quelques secondes, et c'est là que vivent les règles légales.
 *
 * `integration` démarre l'application Nest complète contre une **vraie base
 * PostgreSQL**. C'est délibéré : ce qu'elles vérifient — deux onglets qui
 * créent un dossier en même temps, deux locataires qui réservent le même
 * créneau, un index d'unicité qui absorbe un doublon, un 404 plutôt qu'un 403
 * sur le bien d'autrui — n'existe ni dans une fonction isolée ni derrière des
 * doublures. Le simuler prouverait que les doublures fonctionnent.
 *
 * La base de test est distincte de celle de développement (`bail_test`), créée
 * et migrée par `test/setup-database.ts`. Aucun test ne touche `bail_dev`.
 *
 * Ces suites **doivent tourner en série** : elles partagent une base et la
 * vident entre chaque cas. En parallèle, le nettoyage de l'une efface les
 * données de l'autre en pleine requête — un défaut qui se manifeste par des
 * 401 et des 500 déroutants, sans rapport apparent avec le test qui échoue.
 * D'où `--runInBand` dans le script `test:int` : `maxWorkers` posé au niveau
 * d'un projet est ignoré par Jest, ce qui rend le garde-fou silencieux si on
 * le place là.
 *
 * Pourquoi deux modes de modules : NestJS 12 est distribué en ESM pur. Le
 * runtime CommonJS de Jest ne sait pas le charger, d'où `useESM` sur la seule
 * campagne qui importe Nest — les tests unitaires n'en ont pas besoin et
 * restent sur le chemin le plus simple. C'est aussi pourquoi `npm test` passe
 * par `--experimental-vm-modules`.
 */
const common = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleFileExtensions: ['ts', 'js', 'json'],
};

module.exports = {
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
    },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {
        '^.+\\.ts$': [
          'ts-jest',
          { useESM: true, tsconfig: { module: 'ESNext', moduleResolution: 'bundler' } },
        ],
      },
      // En ESM, les imports relatifs portent une extension `.js` que le
      // transformeur doit retrouver côté source.
      moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
      globalSetup: '<rootDir>/test/setup-database.ts',
      setupFilesAfterEnv: ['<rootDir>/test/setup-env.ts'],
    },
  ],
  // Une campagne d'intégration démarre l'application entière : le délai par
  // défaut de 5 secondes ne suffit pas au premier module chargé.
  testTimeout: 30_000,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/dto/**',
  ],
};
