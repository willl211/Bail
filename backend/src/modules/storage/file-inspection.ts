import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { FILE_INSPECTION_WORKER_SOURCE } from './file-inspection.worker';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const FILE_ERRORS: Record<string, string> = {
  FILE_EMPTY: 'Le fichier est vide. Choisissez un PDF ou une image lisible.',
  FILE_TOO_LARGE: 'Le fichier dépasse la taille autorisée.',
  FILE_TYPE_UNSUPPORTED: 'Format non accepté. Choisissez un PDF, JPEG, PNG ou WebP selon le dépôt.',
  FILE_TYPE_MISMATCH:
    'Le contenu du fichier ne correspond pas au format annoncé. Exportez-le à nouveau en PDF ou en image.',
  FILE_CORRUPT: 'Le fichier est incomplet ou illisible. Exportez-le à nouveau avant de le déposer.',
  PDF_ENCRYPTED: 'Ce PDF est protégé par un mot de passe. Déposez une copie PDF non protégée.',
  PDF_PAGE_LIMIT: 'Le PDF doit contenir entre 1 et 100 pages. Séparez les documents si nécessaire.',
  PDF_ACTIVE_CONTENT:
    'Ce PDF contient des actions ou des pièces jointes non acceptées. Exportez une copie PDF simple.',
  FILE_COMPLEX: 'Ce fichier est trop complexe à lire. Exportez une version simplifiée.',
  IMAGE_TOO_LARGE:
    'L’image dépasse 25 millions de pixels. Réduisez ses dimensions avant de la déposer.',
  IMAGE_ANIMATED: 'Les images animées ne sont pas acceptées. Choisissez une image fixe.',
  UPLOAD_BUSY:
    'Le contrôle des fichiers est momentanément occupé. Réessayez dans quelques instants.',
};
export class FileInspectionError extends Error {
  constructor(readonly code: string) {
    super(FILE_ERRORS[code] ?? FILE_ERRORS.FILE_CORRUPT);
  }
}
export function detectFileType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Deux contrôles simultanés par instance, sans accumuler des fichiers en attente. */
export class FileInspector {
  private readonly workers = new Set<Worker>();
  private closed = false;
  constructor(private readonly timeoutMs = 10_000) {}

  async inspect(
    bytes: Buffer,
    declaredType: string,
    allowed: readonly string[],
    normalizeImage: boolean,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    if (!bytes.length) throw new FileInspectionError('FILE_EMPTY');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new FileInspectionError('FILE_TOO_LARGE');
    if (!allowed.includes(declaredType)) throw new FileInspectionError('FILE_TYPE_UNSUPPORTED');
    const mimeType = detectFileType(bytes);
    if (!mimeType || mimeType !== declaredType) throw new FileInspectionError('FILE_TYPE_MISMATCH');
    if (this.closed || this.workers.size >= 2) throw new FileInspectionError('UPLOAD_BUSY');
    const localRequire = createRequire(resolve(process.cwd(), 'package.json'));
    let worker: Worker;
    try {
      worker = new Worker(FILE_INSPECTION_WORKER_SOURCE, {
        eval: true,
        workerData: {
          bytes,
          mimeType,
          normalizeImage,
          pdfPath: localRequire.resolve('pdf-lib'),
          sharpPath: localRequire.resolve('sharp'),
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
        stdout: true,
        stderr: true,
        // Ne transmet ni le mode Jest/VM, ni les options de diagnostic du processus parent.
        execArgv: [],
      });
    } catch {
      throw new FileInspectionError('UPLOAD_BUSY');
    }
    this.workers.add(worker);
    // Aucune donnée du parseur ou du fichier dans les journaux.
    worker.stdout?.resume();
    worker.stderr?.resume();
    try {
      return await new Promise((resolveResult, reject) => {
        const timer = setTimeout(
          () => reject(new FileInspectionError('FILE_COMPLEX')),
          this.timeoutMs,
        );
        const settle = (callback: () => void) => {
          clearTimeout(timer);
          callback();
        };
        worker.once('message', (result: { ok: boolean; code?: string; bytes?: Uint8Array }) =>
          settle(() => {
            if (!result.ok) reject(new FileInspectionError(result.code ?? 'FILE_CORRUPT'));
            else
              resolveResult({ bytes: result.bytes ? Buffer.from(result.bytes) : bytes, mimeType });
          }),
        );
        worker.once('error', () => settle(() => reject(new FileInspectionError('FILE_COMPLEX'))));
        worker.once('exit', () => settle(() => reject(new FileInspectionError('UPLOAD_BUSY'))));
      });
    } finally {
      await worker.terminate();
      this.workers.delete(worker);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.workers].map((worker) => worker.terminate()));
  }
}
