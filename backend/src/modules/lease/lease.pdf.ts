import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Mise en page du texte verrouillé, sans rédaction de clauses. */
export async function renderLeasePdf(text: string, reference: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(reference); pdf.setCreator('whoma');
  // Date fixe : un même contenu ne change pas d'empreinte à chaque tentative.
  pdf.setCreationDate(new Date('2026-01-01')); pdf.setModificationDate(new Date('2026-01-01'));
  let page = pdf.addPage([595, 842]); let y = 790;
  const line = (value: string) => {
    if (y < 65) { page = pdf.addPage([595, 842]); y = 790; }
    page.drawText(value, { x: 50, y, size: 11, font }); y -= 17;
  };
  for (const paragraph of text.replace(/[\u00a0\u202f]/g, ' ').split('\n')) {
    let row = '';
    for (const character of paragraph) {
      // Refuse explicitement un caractère non encodable plutôt que le supprimer.
      if (font.widthOfTextAtSize(row + character, 11) > 490) { line(row); row = ''; }
      row += character;
    }
    line(row); y -= 6;
  }
  page = pdf.addPage([595, 842]);
  page.drawText(`Signatures - ${reference}`, { x: 50, y: 780, size: 14, font });
  page.drawText('Bailleur', { x: 70, y: 710, size: 12, font });
  page.drawText('Locataire', { x: 330, y: 710, size: 12, font });
  return { content: Buffer.from(await pdf.save()), signaturePage: pdf.getPageCount() };
}
