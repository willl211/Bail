import 'reflect-metadata';
import { testDatabaseUrl } from './setup-database';

/**
 * Environnement de chaque suite d'intégration.
 *
 * `reflect-metadata` est chargé en premier : les décorateurs de Nest en
 * dépendent, et `main.ts` — qui l'importe en production — n'est pas joué ici.
 *
 * `globalSetup` tourne dans un autre processus que les tests : la variable
 * qu'il pose n'y survit pas. Elle est donc recalculée ici, à partir de la même
 * fonction — deux endroits, une seule définition de l'adresse.
 *
 * Les intégrations réglementées restent simulées, comme partout ailleurs
 * (CLAUDE.md règle 5). Un test qui appellerait un vrai prestataire ne serait
 * plus un test : il dépendrait d'un réseau, d'un quota et d'un compte.
 */
process.env.DATABASE_URL = testDatabaseUrl();
process.env.MAIL_DRIVER = 'mock';
process.env.STORAGE_LOCAL_PATH = './storage-test';
process.env.KYC_DRIVER = 'mock';
process.env.PAYMENT_DRIVER = 'mock';
process.env.SIGNATURE_DRIVER = 'mock';
process.env.VIDEO_DRIVER = 'mock';
process.env.PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.SESSION_COOKIE_SECURE = 'false';
// Le hachage bcrypt est le poste le plus coûteux d'une campagne qui crée des
// dizaines de comptes. 4 tours suffisent à exercer le code ; la valeur réelle
// (12) reste celle de la configuration applicative.
process.env.PASSWORD_SALT_ROUNDS = '4';
