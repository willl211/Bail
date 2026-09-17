import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, generateKeyPairSync, verify } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DocusignSignatureDriver } from '../src/modules/signature/docusign-signature.driver';
import type { SignatureEnvelopeInput } from '../src/modules/signature/signature.driver';
import { renderLeasePdf } from '../src/modules/lease/lease.pdf';
import { StorageService } from '../src/modules/storage/storage.service';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createUser, createProperty, createVerifiedFile, TEST_PASSWORD } from './fixtures';
import { testPdf } from './file-fixtures';

// Aucun appel réseau : seul le contrat REST est simulé, avec des documents fictifs.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = (overrides = {}) => new ConfigService({ integrations: { signature: { docusign: {
  baseUrl: 'https://demo.docusign.net/restapi', accountId: 'account-test', integrationKey: 'integration-test',
  userId: 'user-test', hmacSecret: 'secret-test', privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), ...overrides,
} } } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const now = () => new Date().toISOString();
const signedHeader = (body: string) => createHmac('sha256', 'secret-test').update(body).digest('base64');
const notification = (event = 'envelope-completed', extra = {}) => JSON.stringify({ event, generatedDateTime: now(), data: { accountId: 'account-test', envelopeId: 'envelope-test', ...extra } });

describe('DocuSign sandbox — contrat REST et authenticité', () => {
  let driver: DocusignSignatureDriver;
  let input: SignatureEnvelopeInput;
  let calls: { url: string; options?: RequestInit }[];
  let responder: (url: string, options?: RequestInit) => Response | Promise<Response>;
  beforeEach(async () => {
    calls = []; driver = new DocusignSignatureDriver(config());
    const pdf = await renderLeasePdf('DOCUMENT FICTIF — SANS VALEUR CONTRACTUELLE\nÉté : 880 €.', 'TEST');
    input = { reference: 'TEST', subject: 'Test sans valeur contractuelle', transactionId: 'request-test', requestedAt: now(), expiresInDays: 7,
      checksum: createHash('sha256').update(pdf.content).digest('hex'), document: { ...pdf, fileName: 'test.pdf', mimeType: 'application/pdf' },
      annexes: [{ fileName: 'DPE.pdf', content: await testPdf(), mimeType: 'application/pdf' }],
      signers: [{ id: 'LANDLORD', role: 'LANDLORD', fullName: 'Bailleur Test', email: 'owner@example.test' }, { id: 'TENANT', role: 'TENANT', fullName: 'Locataire Test', email: 'tenant@example.test' }],
    };
    responder = (url, options) => url.includes('transaction_ids') ? json({ envelopes: [] }) : options?.method === 'POST' ? json({ envelopeId: 'envelope-test' }) : json({});
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/oauth/token')) return json({ access_token: 'test-token', expires_in: 3600 });
      return responder(String(url), options);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('refuse une URL de production ou une configuration incomplète avant tout appel', () => {
    expect(() => new DocusignSignatureDriver(config({ baseUrl: 'https://na4.docusign.net/restapi' }))).toThrow();
    expect(() => new DocusignSignatureDriver(config({ hmacSecret: '' }))).toThrow();
    expect(calls).toHaveLength(0);
  });
  it('signe le JWT, réutilise le jeton et envoie le PDF, les annexes et deux zones distinctes', async () => {
    await driver.createEnvelope(input); await driver.createEnvelope(input);
    const oauth = calls.filter(c => c.url.includes('/oauth/token'));
    expect(oauth).toHaveLength(1);
    const assertion = new URLSearchParams(oauth[0].options?.body as URLSearchParams).get('assertion')!;
    const parts = assertion.split('.');
    expect(verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), keys.publicKey, Buffer.from(parts[2], 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(parts[1], 'base64url').toString())).toMatchObject({ aud: 'account-d.docusign.com', scope: 'signature impersonation' });
    const posted = JSON.parse(calls.find(c => c.url.endsWith('/envelopes') && c.options?.method === 'POST')!.options!.body as string);
    expect(posted.transactionId).toBe(input.transactionId);
    expect(Buffer.from(posted.documents[0].documentBase64, 'base64')).toEqual(input.document.content);
    expect(Buffer.from(posted.documents[1].documentBase64, 'base64')).toEqual(input.annexes![0].content);
    expect(posted.recipients.signers.map((s: { recipientId: string }) => s.recipientId)).toEqual(['1', '2']);
    expect(posted.recipients.signers[0].tabs.signHereTabs[0].pageNumber).toBe(String((await PDFDocument.load(input.document.content)).getPageCount()));
    expect(calls.every(c => c.options?.redirect === 'error')).toBe(true);
  });
  it('retrouve une enveloppe après perte de réponse sans renvoyer les documents', async () => {
    responder = () => json({ envelopes: [{ envelopeId: 'already-sent' }] });
    expect((await driver.createEnvelope(input)).id).toBe('already-sent');
    expect(calls.filter(c => c.url.endsWith('/envelopes'))).toHaveLength(0);
  });
  it('récupère le conflit de transaction concurrente avec le même identifiant', async () => {
    let lookups = 0;
    responder = url => url.includes('transaction_ids') ? json({ envelopes: ++lookups === 1 ? [] : [{ envelopeId: 'concurrent' }] }) : json({ error: 'duplicate' }, 400);
    expect((await driver.createEnvelope(input)).id).toBe('concurrent');
  });
  it('bloque une tentative ancienne et une empreinte altérée', async () => {
    await expect(driver.createEnvelope({ ...input, requestedAt: new Date(Date.now() - 7 * 86400_000).toISOString() })).rejects.toThrow('ancienne');
    await expect(driver.createEnvelope({ ...input, checksum: 'bad' })).rejects.toThrow('Empreinte');
    expect(calls).toHaveLength(0);
  });
  it('vérifie les octets bruts HMAC et le compte cible', () => {
    const body = notification();
    expect(driver.parseEvent(Buffer.from(body), signedHeader(body)).type).toBe('completed');
    expect(() => driver.parseEvent(Buffer.from(body + ' '), signedHeader(body))).toThrow();
    expect(() => driver.parseEvent(Buffer.from(body), undefined)).toThrow();
    const other = notification('envelope-completed', { accountId: 'other' });
    expect(() => driver.parseEvent(Buffer.from(other), signedHeader(other))).toThrow('Compte');
  });
  it('refuse un destinataire remplacé et attend une preuve individuelle de chaque signature', async () => {
    responder = url => url.endsWith('/recipients') ? json({ signers: input.signers.map((s, i) => ({ recipientId: String(i + 1), name: s.fullName, email: i ? 'intruder@example.test' : s.email, status: 'completed', signedDateTime: now() })) }) : json({ status: 'completed', completedDateTime: now() });
    await expect(driver.readEvents('envelope-test', input.signers)).rejects.toThrow('Destinataire');
  });
  it('télécharge les octets du PDF combiné avec certificat seulement après finalisation', async () => {
    responder = url => url.includes('/documents/') ? new Response(new Uint8Array(input.document.content)) : json({ status: 'completed' });
    expect((await driver.downloadSigned('envelope-test')).content).toEqual(input.document.content);
    expect(calls.at(-1)?.url).toContain('/documents/combined?certificate=true');
    responder = () => json({ status: 'sent' });
    await expect(driver.downloadSigned('envelope-test')).rejects.toThrow('finalisé');
  });
  it('produit un PDF paginé déterministe et refuse les glyphes non pris en charge', async () => {
    const text = Array.from({ length: 180 }, (_, i) => `Ligne fictive ${i} : été, € et caractères français.`).join('\n');
    const a = await renderLeasePdf(text, 'TEST'); const b = await renderLeasePdf(text, 'TEST');
    expect(a.content).toEqual(b.content); expect(a.signaturePage).toBeGreaterThan(3);
    expect((await PDFDocument.load(a.content)).getPageCount()).toBe(a.signaturePage);
    await expect(renderLeasePdf('不可编码', 'TEST')).rejects.toThrow();
  });
});

describe('Signature — parcours HTTP avec vraie base isolée et prestataire simulé', () => {
  let h: Harness;
  let driver: DocusignSignatureDriver;
  let posted: Record<string, any> | null;
  let state: string;
  let completedRecipients: number;
  let failSend: boolean;
  let postCount: number;
  let signedPdf: Buffer;
  let earlyCallback: (() => Promise<void>) | null;
  const api = () => request(h.app.getHttpServer());
  const callback = () => { const body = notification(); return api().post('/api/v1/leases/signature/webhook').set('Content-Type', 'application/json').set('X-Docusign-Signature-1', signedHeader(body)).send(body); };
  const login = async (email: string) => sessionCookie(await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200));

  beforeAll(async () => { driver = new DocusignSignatureDriver(config()); h = await createHarness({ signatureDriver: driver }); signedPdf = await testPdf(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await resetDatabase(h.prisma); posted = null; state = 'sent'; completedRecipients = 0; failSend = false; postCount = 0; earlyCallback = null;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const path = String(url);
      if (path.includes('/oauth/token')) return json({ access_token: 'test-token', expires_in: 3600 });
      if (path.includes('transaction_ids')) return json({ envelopes: posted ? [{ envelopeId: 'envelope-test' }] : [] });
      if (path.endsWith('/envelopes') && options?.method === 'POST') {
        postCount++; posted = JSON.parse(options.body as string);
        if (earlyCallback) await earlyCallback();
        if (failSend) throw new Error('network response lost');
        return json({ envelopeId: 'envelope-test' });
      }
      if (path.endsWith('/custom_fields')) return json(posted!.customFields);
      if (path.endsWith('/recipients')) return json({ signers: posted!.recipients.signers.map((s: object, i: number) => ({ ...s, status: i < completedRecipients ? 'completed' : 'sent', signedDateTime: now() })) });
      if (path.includes('/documents/combined')) return new Response(new Uint8Array(signedPdf));
      if (path.endsWith('/envelope-test')) return json({ status: state, completedDateTime: now(), statusChangedDateTime: now() });
      throw new Error('Unexpected sandbox route: ' + path);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  async function fixture(published = true, store = true) {
    const owner = await createUser(h.prisma, 'OWNER'); const tenant = await createUser(h.prisma, 'TENANT');
    const property = await createProperty(h.prisma, owner.id); const file = await createVerifiedFile(h.prisma, tenant.id);
    const application = await h.prisma.application.create({ data: { propertyId: property.id, tenantId: tenant.id, tenantFileId: file.id } });
    // Publication simulée uniquement dans bail_test : ce texte ne contient aucune clause juridique.
    const body = 'DOCUMENT FICTIF — SANS VALEUR CONTRACTUELLE\nBailleur : {{bailleurNomComplet}}\nLocataire : {{locataireNomComplet}}\nSurface : {{logementSurfaceM2}}';
    const checksum = createHash('sha256').update(body).digest('hex');
    const fieldSchema = { bailleurNomComplet: { type: 'string', required: true }, locataireNomComplet: { type: 'string', required: true }, logementSurfaceM2: { type: 'number', required: true } };
    const template = await h.prisma.leaseTemplate.create({ data: { code: 'TECHNICAL_TEST', version: 1, label: 'Fixture technique', type: 'NU', body, checksum, fieldSchema, isActive: published, publishedAt: published ? new Date() : null } });
    await h.prisma.platformSetting.create({ data: { key: 'lease.generationEnabled', value: true } });
    if (store) {
      const saved = await h.app.get(StorageService).save('private', 'tests/signature', { originalname: 'test.pdf', mimetype: 'application/pdf', size: signedPdf.length, buffer: signedPdf }, ['application/pdf']);
      await h.prisma.propertyDocument.updateMany({ where: { propertyId: property.id }, data: { storageKey: saved.key } });
    }
    const lease = await h.prisma.lease.create({ data: { reference: 'BAIL-TEST-0001', propertyId: property.id, tenantId: tenant.id, applicationId: application.id, templateId: template.id, templateChecksum: checksum, type: 'NU', status: 'DRAFT',
      fieldValues: { bailleurNomComplet: owner.firstName + ' ' + owner.lastName, locataireNomComplet: tenant.firstName + ' ' + tenant.lastName, logementSurfaceM2: 68 },
      startDate: new Date('2026-10-01'), endDate: new Date('2029-10-01'), durationMonths: 36, rentCents: 88000, chargesCents: 8500, depositCents: 88000 } });
    return { owner, tenant, property, lease, cookie: await login(owner.email) };
  }
  const send = (f: Awaited<ReturnType<typeof fixture>>) => api().post(`/api/v1/leases/${f.lease.reference}/send`).set('Cookie', f.cookie);

  it('bloque les modèles non publiés et les annexes absentes avant tout envoi externe', async () => {
    const f = await fixture(false, false); await send(f).expect(400); expect(postCount).toBe(0);
    await h.prisma.leaseTemplate.updateMany({ data: { isActive: true, publishedAt: new Date() } });
    await send(f).expect(400); expect(postCount).toBe(0);
  });
  it('conserve une tentative unique lors de deux envois simultanés, sans exposer les octets privés', async () => {
    const f = await fixture(); const responses = await Promise.all([send(f), send(f)]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const current = await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } });
    expect(current.signatureRequestId).toBeTruthy(); expect(current.signatureEnvelopeId).toBe('envelope-test');
    expect(responses[0].body.signatureRequest).toBeUndefined(); expect(responses[0].body.signatureRequestId).toBeUndefined();
    expect(await h.prisma.emailMessage.count({ where: { template: 'lease-ready-to-sign' } })).toBe(2);
    expect(posted!.documents).toHaveLength(2);
    await send(f).expect(200);
    expect(postCount).toBe(1);
  });
  it('reprend une réponse perdue avec le même instantané et la même enveloppe', async () => {
    const f = await fixture(); failSend = true; await send(f).expect(503);
    const before = await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } });
    await h.prisma.user.update({ where: { id: f.owner.id }, data: { firstName: 'Nouveau prénom' } });
    failSend = false; const resumed = await send(f).expect(200);
    expect(resumed.body.signers[0].fullName).toBe(f.owner.firstName + ' ' + f.owner.lastName);
    const after = await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } });
    expect(after.signatureRequest).toEqual(before.signatureRequest); expect(postCount).toBe(1);
  });
  it('rattache une notification arrivée avant la réponse de création', async () => {
    const f = await fixture(); state = 'completed'; completedRecipients = 2;
    earlyCallback = async () => { await callback().expect(200); };
    const response = await send(f).expect(200); expect(response.body.status).toBe('SIGNED');
  });
  it('attend la finalisation après les deux signatures et ignore les rejeux', async () => {
    const f = await fixture(); await send(f).expect(200); completedRecipients = 2;
    await callback().expect(200);
    expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } })).status).toBe('PARTIALLY_SIGNED');
    state = 'completed'; await callback().expect(200); await callback().expect(200);
    const current = await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } });
    expect(current.status).toBe('SIGNED');
    expect(await h.prisma.emailMessage.count({ where: { template: 'lease-signed' } })).toBe(2);
  });
  it('refuse une notification falsifiée et une modification des destinataires', async () => {
    const f = await fixture(); await send(f).expect(200);
    await api().post('/api/v1/leases/signature/webhook').send(JSON.parse(notification())).expect(400);
    posted!.recipients.signers[1].email = 'intruder@example.test'; state = 'completed'; completedRecipients = 2;
    await callback().expect(400);
    expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } })).status).toBe('SENT_FOR_SIGNATURE');
  });
  it.each(['declined', 'voided'])('conserve un refus ou une annulation %s malgré un completed tardif', async status => {
    const f = await fixture(); await send(f).expect(200); state = status; await callback().expect(200);
    const before = await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } });
    expect(before.status).toBe(status === 'declined' ? 'DECLINED' : 'CANCELLED');
    state = 'completed'; completedRecipients = 2; await callback().expect(200);
    expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: f.lease.id } })).status).toBe(before.status);
  });
  it('limite le PDF signé aux parties et aux agents, jamais à un autre compte', async () => {
    const f = await fixture(); await send(f).expect(200);
    const url = `/api/v1/leases/${f.lease.reference}/signed-document`;
    await api().get(url).set('Cookie', f.cookie).expect(409);
    completedRecipients = 2; state = 'completed'; await callback().expect(200);
    const tenantCookie = await login(f.tenant.email); const agent = await createUser(h.prisma, 'AGENT'); const outsider = await createUser(h.prisma, 'OWNER');
    for (const cookie of [f.cookie, tenantCookie, await login(agent.email)]) {
      const response = await api().get(url).set('Cookie', cookie).expect(200);
      expect(response.headers['cache-control']).toBe('no-store'); expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.body).toEqual(signedPdf);
    }
    await api().get(url).set('Cookie', await login(outsider.email)).expect(404);
    await api().get(url).expect(401);
  });
});
