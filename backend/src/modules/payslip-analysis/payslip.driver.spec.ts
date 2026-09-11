import { checkAnalysisFile, OpenAIPayslipDriver, DisabledPayslipDriver } from './payslip.driver';
import { samplePayslip, fictionalPayslipPdf } from '../../../test/payslip-fixtures';

describe('Connecteur de lecture documentaire', () => {
  const response = (text = JSON.stringify(samplePayslip())) =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
      }),
    );
  it('transmet uniquement le fichier au modèle, sans stockage de réponse ni outils', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(response());
    const driver = new OpenAIPayslipDriver('test-key', 'configured-test-model', transport);
    const bytes = await fictionalPayslipPdf();
    const result = await driver.analyze({ bytes, mimeType: 'application/pdf', pageCount: 1 });
    expect(result.netBeforeTaxCents.value).toBe(200000);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({
      model: 'configured-test-model',
      store: false,
      max_output_tokens: 4000,
      text: { format: { type: 'json_schema', strict: true } },
    });
    expect(body.tools).toBeUndefined();
    expect(body.input[0].content[1]).toEqual({
      type: 'input_file',
      filename: 'bulletin.pdf',
      file_data: `data:application/pdf;base64,${bytes.toString('base64')}`,
    });
    expect(JSON.stringify(body)).not.toContain('test-key');
    expect(body.instructions).toContain('NON FIABLE');
  });
  it('utilise une image embarquée, sans URL de stockage privée', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(response());
    await new OpenAIPayslipDriver('test-key', 'test-model', transport).analyze({
      bytes: Buffer.from('test-image'),
      mimeType: 'image/png',
      pageCount: 1,
    });
    const body = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(body.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,/);
  });
  it.each([
    { status: 'incomplete', output: [] },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }],
    },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }],
    },
    {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"verified":true}' }] }],
    },
  ])('n’accepte pas une sortie incomplète, refusée ou invalide (%#)', async (payload) => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(
      new OpenAIPayslipDriver('test', 'test', transport).analyze({
        bytes: Buffer.from('a'),
        mimeType: 'image/png',
        pageCount: 1,
      }),
    ).rejects.toThrow();
  });
  it('masque les erreurs du fournisseur et autorise la reprise après 429', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('identité sensible', { status: 429 }));
    await expect(
      new OpenAIPayslipDriver('test', 'test', transport).analyze({
        bytes: Buffer.from('a'),
        mimeType: 'image/png',
        pageCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_BUSY', retryable: true });
  });
  it('refuse les faux PDF, les PDF trop longs et les octets d’un autre format', async () => {
    await expect(
      checkAnalysisFile(Buffer.from('%PDF-1.4 faux'), 'application/pdf'),
    ).rejects.toMatchObject({ code: 'FILE_UNREADABLE' });
    await expect(
      checkAnalysisFile(await fictionalPayslipPdf(11), 'application/pdf'),
    ).rejects.toMatchObject({ code: 'PAGE_LIMIT' });
    await expect(checkAnalysisFile(Buffer.from('HTML'), 'image/png')).rejects.toThrow();
    expect(await checkAnalysisFile(await fictionalPayslipPdf(2), 'application/pdf')).toBe(2);
  });
  it('le mode désactivé ne produit jamais de résultat simulé', async () => {
    const driver = new DisabledPayslipDriver();
    expect(driver.enabled).toBe(false);
    await expect(driver.analyze()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
