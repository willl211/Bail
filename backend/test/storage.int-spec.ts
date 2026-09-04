import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { LocalStorageDriver } from '../src/modules/storage/local-storage.driver';
import { S3StorageDriver } from '../src/modules/storage/s3-storage.driver';
import type { StorageDriver } from '../src/modules/storage/storage.driver';

/**
 * Les deux supports de stockage, soumis au même contrat.
 *
 * Le même jeu de cas est joué contre le disque et contre un vrai service S3
 * (MinIO, `npm run storage:up`). C'est le seul moyen d'affirmer que passer de
 * l'un à l'autre ne change rien pour le code métier : deux campagnes séparées
 * finiraient par vérifier deux comportements différents.
 *
 * Ce qui compte le plus ici est le **cloisonnement** : un fichier déposé en
 * privé ne doit être atteignable par aucun chemin public, quelle que soit la
 * clé qu'on devine.
 */
const PNG = Buffer.from(`89504e470d0a1a0a${'00'.repeat(40)}`, 'hex');

async function lire(flux: Readable): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  for await (const morceau of flux) morceaux.push(Buffer.from(morceau as Buffer));
  return Buffer.concat(morceaux);
}

/** Le service S3 local est optionnel : la campagne le dit plutôt que de mentir. */
async function minioJoignable(): Promise<boolean> {
  try {
    const reponse = await fetch('http://localhost:9000/minio/health/live', {
      signal: AbortSignal.timeout(2000),
    });
    return reponse.ok;
  } catch {
    return false;
  }
}

describe('Contrat de stockage', () => {
  let racine: string;
  let local: LocalStorageDriver;

  beforeAll(async () => {
    racine = await mkdtemp(join(tmpdir(), 'bail-storage-'));
    local = new LocalStorageDriver({
      root: racine,
      publicBaseUrl: 'http://localhost:4000/uploads',
    });
  });

  afterAll(async () => {
    await rm(racine, { recursive: true, force: true });
  });

  /** Cas communs aux deux supports. */
  const contrat = (nom: string, obtenir: () => StorageDriver) => {
    describe(nom, () => {
      it('écrit puis relit un fichier public', async () => {
        const driver = obtenir();
        await driver.put('public', 'properties/mz-0142/photo.png', PNG, 'image/png');
        const relu = await lire(await driver.get('public', 'properties/mz-0142/photo.png'));
        expect(relu.equals(PNG)).toBe(true);
      });

      it('écrit puis relit un fichier privé', async () => {
        const driver = obtenir();
        await driver.put('private', 'tenants/loc-1/piece.pdf', PNG, 'application/pdf');
        const relu = await lire(await driver.get('private', 'tenants/loc-1/piece.pdf'));
        expect(relu.equals(PNG)).toBe(true);
      });

      it('ne donne aucune URL à un fichier privé', async () => {
        // Un fichier privé n'a pas d'URL et ne doit pas en avoir : c'est le
        // sens même du régime.
        expect(obtenir().publicUrl('private', 'tenants/loc-1/piece.pdf')).toBeNull();
      });

      it('donne une URL à un fichier public', () => {
        expect(obtenir().publicUrl('public', 'properties/mz-0142/photo.png')).toContain(
          'properties/mz-0142/photo.png',
        );
      });

      it('n’expose pas une clé privée depuis le régime public', async () => {
        // Le cœur du cloisonnement : deviner la clé ne suffit pas, encore
        // faut-il être dans le bon espace — et il n'y a pas de route publique
        // vers celui des pièces de dossier.
        const driver = obtenir();
        await driver.put('private', 'tenants/loc-2/secret.pdf', PNG, 'application/pdf');
        await expect(driver.get('public', 'tenants/loc-2/secret.pdf')).rejects.toThrow();
      });

      it('supprime, et tolère une seconde suppression', async () => {
        const driver = obtenir();
        await driver.put('public', 'properties/mz-0142/jeter.png', PNG, 'image/png');
        await driver.delete('public', 'properties/mz-0142/jeter.png');

        await expect(driver.get('public', 'properties/mz-0142/jeter.png')).rejects.toThrow();
        // Idempotence : la suppression accompagne une opération métier déjà
        // accomplie, la faire échouer laisserait base et stockage en désaccord.
        await expect(
          driver.delete('public', 'properties/mz-0142/jeter.png'),
        ).resolves.toBeUndefined();
      });

      it('signale un fichier inexistant plutôt que de renvoyer du vide', async () => {
        await expect(obtenir().get('private', 'nexiste/pas.pdf')).rejects.toThrow();
      });
    });
  };

  contrat('disque local', () => local);

  describe('objet S3', () => {
    let s3: S3StorageDriver | null = null;

    beforeAll(async () => {
      if (!(await minioJoignable())) return;
      s3 = new S3StorageDriver({
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        accessKeyId: 'bail',
        secretAccessKey: 'bailbailbail',
        publicBucket: 'bail-public',
        privateBucket: 'bail-private',
        forcePathStyle: true,
        publicBaseUrl: 'http://localhost:9000/bail-public',
      });
    });

    it('est joignable, sans quoi ces cas ne prouveraient rien', async () => {
      // Assertion explicite plutôt qu'un `describe.skip` silencieux : une
      // campagne qui se tait quand le service manque ressemble à une campagne
      // qui passe.
      expect(await minioJoignable()).toBe(true);
    });

    contrat('contrat commun', () => {
      if (!s3) throw new Error('MinIO injoignable : lancez `npm run storage:up`.');
      return s3;
    });
  });

  describe('traversée de répertoire, sur disque', () => {
    it('refuse une clé qui sortirait de la racine du régime', async () => {
      // Sur disque, une clé forgée pourrait franchir la frontière entre public
      // et privé — c'est exactement ainsi qu'une pièce d'identité deviendrait
      // téléchargeable. En objet, la question ne se pose pas : une clé n'est
      // qu'un nom, sans hiérarchie à remonter.
      await expect(local.get('public', '../private/tenants/loc-1/piece.pdf')).rejects.toThrow();
      await expect(
        local.put('public', '../../echappe.txt', PNG, 'text/plain'),
      ).rejects.toThrow();
    });
  });
});
