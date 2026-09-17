import sharp from 'sharp';
import { FileInspector, MAX_UPLOAD_BYTES } from './file-inspection';
import { testImage, testPdf } from '../../../test/file-fixtures';

const DOCUMENTS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
describe('Validation réelle des fichiers avant stockage', () => {
  let inspector: FileInspector;
  beforeEach(() => {
    inspector = new FileInspector();
  });
  afterEach(async () => {
    await inspector.close();
  });
  const checkPdf = (bytes: Buffer) => inspector.inspect(bytes, 'application/pdf', DOCUMENTS, false);

  it('conserve exactement un PDF valide, sans altérer un original', async () => {
    const bytes = await testPdf();
    const result = await checkPdf(bytes);
    expect(result.mimeType).toBe('application/pdf');
    expect(result.bytes.equals(bytes)).toBe(true);
  });
  it.each(['jpeg', 'png', 'webp'] as const)(
    'décode une image %s privée sans modifier ses octets',
    async (format) => {
      const bytes = await testImage(format);
      const result = await inspector.inspect(bytes, `image/${format}`, DOCUMENTS, false);
      expect(result.bytes.equals(bytes)).toBe(true);
    },
  );
  it('réencode les photos publiques sans EXIF ni contenu ajouté après l’image', async () => {
    const image = await testImage('jpeg', true);
    expect((await sharp(image).metadata()).exif).toBeDefined();
    const bytes = Buffer.concat([image, Buffer.from('<script>fixture</script>')]);
    const result = await inspector.inspect(bytes, 'image/jpeg', DOCUMENTS, true);
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
    expect(result.bytes.includes(Buffer.from('<script>'))).toBe(false);
    expect((await sharp(result.bytes).metadata()).width).toBe(48);
  });
  it('refuse un fichier vide ou dépassant la taille maximale réelle', async () => {
    await expect(checkPdf(Buffer.alloc(0))).rejects.toMatchObject({ code: 'FILE_EMPTY' });
    await expect(checkPdf(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
  it('refuse une fausse déclaration MIME et un document là où seules les photos sont permises', async () => {
    await expect(
      inspector.inspect(await testImage('jpeg'), 'image/png', DOCUMENTS, true),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_MISMATCH' });
    await expect(
      inspector.inspect(await testPdf(), 'application/pdf', ['image/png'], true),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_UNSUPPORTED' });
    await expect(checkPdf(Buffer.from('<html>not a PDF</html>'))).rejects.toMatchObject({
      code: 'FILE_TYPE_MISMATCH',
    });
  });
  it('refuse un faux PDF même avec une en-tête et une fin apparemment correctes', async () => {
    await expect(checkPdf(Buffer.from('%PDF-1.4\ntext only\n%%EOF'))).rejects.toMatchObject({
      code: 'FILE_CORRUPT',
    });
    const bytes = await testPdf();
    await expect(checkPdf(bytes.subarray(0, bytes.length - 15))).rejects.toMatchObject({
      code: 'FILE_CORRUPT',
    });
    await expect(checkPdf(await testPdf({ corruptStream: true }))).rejects.toMatchObject({
      code: 'FILE_CORRUPT',
    });
  });
  it('refuse un PDF chiffré, un PDF actif et un PDF trop long', async () => {
    await expect(checkPdf(await testPdf({ encrypted: true }))).rejects.toMatchObject({
      code: 'PDF_ENCRYPTED',
    });
    await expect(checkPdf(await testPdf({ active: true }))).rejects.toMatchObject({
      code: 'PDF_ACTIVE_CONTENT',
    });
    await expect(checkPdf(await testPdf({ pages: 101 }))).rejects.toMatchObject({
      code: 'PDF_PAGE_LIMIT',
    });
  });
  it.each(['jpeg', 'png', 'webp'] as const)(
    'refuse les pixels tronqués de l’image %s',
    async (format) => {
      const bytes = await testImage(format);
      await expect(
        inspector.inspect(
          bytes.subarray(0, Math.floor(bytes.length / 2)),
          `image/${format}`,
          DOCUMENTS,
          false,
        ),
      ).rejects.toMatchObject({ code: 'FILE_CORRUPT' });
    },
  );
  it('refuse les dimensions excessives avant de décoder tous les pixels', async () => {
    const bytes = await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(inspector.inspect(bytes, 'image/png', DOCUMENTS, false)).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    });
  });
  it('interrompt un contrôle trop long et libère le worker', async () => {
    const short = new FileInspector(1);
    await expect(
      short.inspect(await testPdf(), 'application/pdf', DOCUMENTS, false),
    ).rejects.toMatchObject({ code: 'FILE_COMPLEX' });
    await short.close();
  });
  it('refuse la déclaration d’animation APNG même si le décodeur ne lirait que la première frame', async () => {
    const png = await testImage('png');
    const animationChunk = Buffer.alloc(20);
    animationChunk.writeUInt32BE(8, 0);
    animationChunk.write('acTL', 4, 'ascii');
    animationChunk.writeUInt32BE(2, 8);
    const bytes = Buffer.concat([png.subarray(0, 33), animationChunk, png.subarray(33)]);
    await expect(inspector.inspect(bytes, 'image/png', DOCUMENTS, false)).rejects.toMatchObject({
      code: 'IMAGE_ANIMATED',
    });
  });
  it('borne la concurrence sans accumuler de fichiers en attente', async () => {
    const bytes = await testPdf();
    const first = checkPdf(bytes),
      second = checkPdf(bytes);
    await expect(checkPdf(bytes)).rejects.toMatchObject({ code: 'UPLOAD_BUSY' });
    await Promise.all([first, second]);
    await expect(checkPdf(bytes)).resolves.toMatchObject({ mimeType: 'application/pdf' });
  });
});
