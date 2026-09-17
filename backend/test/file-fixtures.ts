import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

/** Fichiers générés pour les tests, sans justificatif ni donnée personnelle réels. */
export async function testPdf(
  options: { pages?: number; active?: boolean; encrypted?: boolean; corruptStream?: boolean } = {},
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (options.pages ?? 1); i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText('DOCUMENT FICTIF DE TEST - SANS VALEUR DE JUSTIFICATIF', {
      x: 30,
      y: 760,
      size: 12,
      font,
    });
    if (options.corruptStream) {
      const broken = pdf.context.stream(Buffer.from('invalid compressed data'), {
        Filter: 'FlateDecode',
      });
      page.node.set(PDFName.of('Contents'), pdf.context.register(broken));
    }
  }
  if (options.active) pdf.addJavaScript('test', 'app.alert("fixture")');
  if (options.encrypted)
    pdf.context.trailerInfo.Encrypt = pdf.context.register(
      pdf.context.obj({ Filter: 'Standard', V: 1, R: 2 }),
    );
  return Buffer.from(await pdf.save());
}

export async function testImage(
  format: 'jpeg' | 'png' | 'webp' = 'png',
  metadata = false,
): Promise<Buffer> {
  let image = sharp({ create: { width: 48, height: 32, channels: 3, background: '#849565' } });
  if (metadata) image = image.withExif({ IFD0: { Artist: 'Fixture privee' } });
  return image.toFormat(format).toBuffer();
}
