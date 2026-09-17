/* eslint-disable @typescript-eslint/no-require-imports -- worker autonome CommonJS, sans imports du processus parent */
import type sharpFactory from 'sharp';
/**
 * Fonction autonome sérialisée dans un worker Node : les octets du fichier
 * restent des données. Aucun chemin ni code fourni par le client n'est exécuté.
 * Les dépendances sont résolues par le serveur avant le démarrage du worker.
 */
async function inspectFileInWorker() {
  const { parentPort, workerData } =
    require('node:worker_threads') as typeof import('node:worker_threads');
  const { bytes, mimeType, normalizeImage, sharpPath, pdfPath } = workerData as {
    bytes: Uint8Array;
    mimeType: string;
    normalizeImage: boolean;
    sharpPath: string;
    pdfPath: string;
  };
  const input = Buffer.from(bytes);
  const fail = (code: string): never => {
    throw new Error(code);
  };
  try {
    if (mimeType === 'application/pdf') {
      const {
        PDFDocument,
        PDFDict,
        PDFArray,
        PDFName,
        PDFRef,
        PDFRawStream,
        PDFInvalidObject,
        EncryptedPDFError,
        decodePDFRawStream,
      } = require(pdfPath) as typeof import('pdf-lib');
      if (
        !/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(input.toString('latin1', 0, 12)) ||
        !/%%EOF\s*$/.test(input.subarray(-1024).toString('latin1'))
      )
        fail('FILE_CORRUPT');
      let pdf: import('pdf-lib').PDFDocument;
      try {
        pdf = await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: true });
      } catch (error) {
        if (
          error instanceof EncryptedPDFError ||
          /PDFDocument\.load.*is encrypted\./.test((error as Error).message)
        )
          fail('PDF_ENCRYPTED');
        fail('FILE_CORRUPT');
      }
      const pages = pdf!.getPages();
      if (!pages.length || pages.length > 100) fail('PDF_PAGE_LIMIT');
      // Refuse les actions actives et pièces jointes, y compris dans les objets compressés.
      const activeKeys = new Set([
        'JS',
        'JavaScript',
        'AA',
        'EmbeddedFiles',
        'EF',
        'XFA',
        'RichMediaContent',
        'RichMediaSettings',
      ]);
      const activeActions = new Set([
        'JavaScript',
        'Launch',
        'SubmitForm',
        'ImportData',
        'GoToR',
        'GoToE',
        'Rendition',
        'Movie',
        'Sound',
      ]);
      const objects = pdf!.context.enumerateIndirectObjects();
      const pending: unknown[] = objects.map(([, value]) => value);
      const seen = new Set<unknown>();
      let visited = 0;
      while (pending.length) {
        const object = pending.pop();
        if (!object || seen.has(object)) continue;
        seen.add(object);
        if (++visited > 100_000) fail('FILE_COMPLEX');
        if (object instanceof PDFInvalidObject) fail('FILE_CORRUPT');
        if (object instanceof PDFRef) {
          const resolved = pdf!.context.lookup(object);
          if (!resolved) fail('FILE_CORRUPT');
          pending.push(resolved);
        } else if (object instanceof PDFRawStream) {
          pending.push(object.dict);
        } else if (object instanceof PDFDict) {
          for (const [key, value] of object.entries()) {
            if (activeKeys.has(key.decodeText())) fail('PDF_ACTIVE_CONTENT');
            if (key.decodeText() === 'S') {
              const action = value instanceof PDFRef ? pdf!.context.lookup(value) : value;
              if (action instanceof PDFName && activeActions.has(action.decodeText()))
                fail('PDF_ACTIVE_CONTENT');
            }
            pending.push(value);
          }
        } else if (object instanceof PDFArray) {
          pending.push(...object.asArray());
        }
      }
      let decodedBytes = 0;
      const decodedStreams = new Set<unknown>();
      for (const page of pages) {
        const { width, height } = page.getSize();
        if (
          ![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= 14400)
        )
          fail('FILE_CORRUPT');
        const contents = page.node.Contents();
        const streams =
          contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
        for (const reference of streams) {
          const stream = reference instanceof PDFRef ? pdf!.context.lookup(reference) : reference;
          if (!(stream instanceof PDFRawStream)) fail('FILE_CORRUPT');
          if (decodedStreams.has(stream)) continue;
          decodedStreams.add(stream);
          const decoder = decodePDFRawStream(stream as import('pdf-lib').PDFRawStream);
          while (true) {
            const chunk = decoder.getBytes(1024 * 1024);
            decodedBytes += chunk.length;
            if (decodedBytes > 32 * 1024 * 1024) fail('FILE_COMPLEX');
            if (chunk.length < 1024 * 1024) break;
          }
        }
      }
      parentPort!.postMessage({ ok: true });
    } else {
      if (mimeType === 'image/png') {
        // Certains décodeurs ne lisent que la première frame d'un APNG.
        for (let offset = 8; offset + 12 <= input.length;) {
          const length = input.readUInt32BE(offset);
          if (offset + 12 + length > input.length) fail('FILE_CORRUPT');
          if (input.toString('ascii', offset + 4, offset + 8) === 'acTL') fail('IMAGE_ANIMATED');
          offset += 12 + length;
        }
      }
      const sharp = require(sharpPath) as typeof sharpFactory;
      sharp.cache(false);
      sharp.concurrency(1);
      const options = { failOn: 'warning' as const, limitInputPixels: 25_000_000 };
      const metadata = await sharp(input, options).metadata();
      const formats: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpeg',
        'image/webp': 'webp',
      };
      if (metadata.format !== formats[mimeType]) fail('FILE_TYPE_MISMATCH');
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 25_000_000)
        fail('IMAGE_TOO_LARGE');
      if ((metadata.pages ?? 1) !== 1) fail('IMAGE_ANIMATED');
      // metadata() seule ne décode pas les pixels : forcer le décodage complet.
      if (normalizeImage) {
        const output = await sharp(input, options)
          .rotate()
          .toFormat(formats[mimeType] as 'jpeg' | 'png' | 'webp', { quality: 95 })
          .toBuffer();
        if (output.length > 15 * 1024 * 1024) fail('FILE_TOO_LARGE');
        parentPort!.postMessage({ ok: true, bytes: output });
      } else {
        await sharp(input, options).raw().toBuffer();
        parentPort!.postMessage({ ok: true });
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    const codes = [
      'FILE_CORRUPT',
      'FILE_TYPE_MISMATCH',
      'PDF_ENCRYPTED',
      'PDF_PAGE_LIMIT',
      'PDF_ACTIVE_CONTENT',
      'FILE_COMPLEX',
      'IMAGE_TOO_LARGE',
      'IMAGE_ANIMATED',
      'FILE_TOO_LARGE',
    ];
    const code = codes.includes(message)
      ? message
      : /pixel limit/i.test(message)
        ? 'IMAGE_TOO_LARGE'
        : 'FILE_CORRUPT';
    parentPort!.postMessage({ ok: false, code });
  }
}

export const FILE_INSPECTION_WORKER_SOURCE = `(${inspectFileInWorker.toString()})()`;
