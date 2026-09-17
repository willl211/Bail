import { jest } from '@jest/globals';
import request from 'supertest';
import sharp from 'sharp';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createProperty, createUser, TEST_PASSWORD } from './fixtures';
import { testImage, testPdf } from './file-fixtures';
import { STORAGE_DRIVER, type StorageDriver } from '../src/modules/storage/storage.driver';
import { StorageService, DOCUMENT_TYPES } from '../src/modules/storage/storage.service';
import { PayslipAnalysisService } from '../src/modules/payslip-analysis/payslip-analysis.service';

describe('Dépôts validés avant écriture, sans perdre les pièces existantes', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
  });
  afterEach(() => jest.restoreAllMocks());
  const api = () => request(h.app.getHttpServer());
  const driver = () => h.app.get<StorageDriver>(STORAGE_DRIVER);
  const login = async (email: string) =>
    sessionCookie(
      await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200),
    );
  async function tenant() {
    const user = await createUser(h.prisma, 'TENANT');
    const file = await h.prisma.tenantFile.create({
      data: { tenantId: user.id, reference: `LOC-${user.id}`, status: 'SUBMITTED' },
    });
    return { user, file, cookie: await login(user.email) };
  }
  async function owner() {
    const user = await createUser(h.prisma, 'OWNER');
    const property = await createProperty(h.prisma, user.id, { status: 'DRAFT' });
    return { user, property, cookie: await login(user.email) };
  }
  const tenantUpload = (cookie: string, bytes: Buffer, mimeType = 'application/pdf') =>
    api()
      .post('/api/v1/tenant/file/documents')
      .set('Cookie', cookie)
      .field('type', 'PAYSLIP')
      .attach('file', bytes, { filename: 'specimen.pdf', contentType: mimeType });
  const diagnostic = (reference: string, cookie: string, bytes: Buffer) =>
    api()
      .post(`/api/v1/owner/properties/${reference}/documents`)
      .set('Cookie', cookie)
      .field('type', 'DPE')
      .attach('file', bytes, { filename: 'diagnostic.pdf', contentType: 'application/pdf' });
  async function read(scope: 'private' | 'public', key: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of await driver().get(scope, key)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  it('refuse le faux PDF avant stockage, historique ou mise en file IA', async () => {
    const c = await tenant();
    const put = jest.spyOn(driver(), 'put');
    const enqueue = jest.spyOn(h.app.get(PayslipAnalysisService), 'enqueue');
    const response = await tenantUpload(c.cookie, Buffer.from('%PDF-1.4\nfalse\n%%EOF')).expect(
      400,
    );
    expect(response.body.code).toBe('FILE_CORRUPT');
    expect(response.body.message).toContain('illisible');
    expect(put).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await h.prisma.tenantDocument.count()).toBe(0);
    expect(await h.prisma.tenantFileEvent.count()).toBe(0);
    expect(
      (await h.prisma.tenantFile.findUniqueOrThrow({ where: { id: c.file.id } })).revision,
    ).toBe(1);
  });
  it('stocke un vrai PDF en privé, avec sa taille réelle, et le retire avec sa pièce', async () => {
    const c = await tenant(),
      bytes = await testPdf();
    await tenantUpload(c.cookie, bytes).expect(201);
    const document = await h.prisma.tenantDocument.findFirstOrThrow();
    expect(document).toMatchObject({
      status: 'PENDING',
      fileSize: bytes.length,
      mimeType: 'application/pdf',
    });
    expect((await read('private', document.storageKey!)).equals(bytes)).toBe(true);
    expect(driver().publicUrl('private', document.storageKey!)).toBeNull();
    await api()
      .delete(`/api/v1/tenant/file/documents/${document.id}`)
      .set('Cookie', c.cookie)
      .expect(200);
    await expect(read('private', document.storageKey!)).rejects.toThrow();
    expect(await h.prisma.payslipAnalysis.count()).toBe(0);
  });
  it('garde la borne de 10 Mo du dépôt locataire avant validation', async () => {
    const c = await tenant();
    await tenantUpload(c.cookie, Buffer.alloc(10 * 1024 * 1024 + 1)).expect(413);
    expect(await h.prisma.tenantDocument.count()).toBe(0);
  });
  it('refuse une image déclarée PDF et une fausse photo sans modifier l’annonce', async () => {
    const c = await owner();
    await diagnostic(c.property.reference, c.cookie, await testImage()).expect(400);
    const response = await api()
      .post(`/api/v1/owner/properties/${c.property.reference}/photos`)
      .set('Cookie', c.cookie)
      .attach('file', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(response.body.code).toBe('FILE_CORRUPT');
    expect(await h.prisma.propertyPhoto.count()).toBe(0);
    expect(
      (await h.prisma.property.findUniqueOrThrow({ where: { id: c.property.id } })).reviewRevision,
    ).toBe(1);
  });
  it('conserve le diagnostic précédent si son remplacement est invalide', async () => {
    const c = await owner(),
      bytes = await testPdf();
    await diagnostic(c.property.reference, c.cookie, bytes).expect(201);
    const original = await h.prisma.propertyDocument.findFirstOrThrow();
    const property = await h.prisma.property.findUniqueOrThrow({ where: { id: c.property.id } });
    const events = await h.prisma.propertyReviewEvent.count();
    await diagnostic(c.property.reference, c.cookie, Buffer.from('%PDF-1.4 invalid')).expect(400);
    expect(await h.prisma.propertyDocument.findFirstOrThrow()).toEqual(original);
    expect((await read('private', original.storageKey)).equals(bytes)).toBe(true);
    expect(
      (await h.prisma.property.findUniqueOrThrow({ where: { id: c.property.id } })).reviewRevision,
    ).toBe(property.reviewRevision);
    expect(await h.prisma.propertyReviewEvent.count()).toBe(events);
  });
  it('remplace un diagnostic valide puis supprime les octets de l’ancienne version', async () => {
    const c = await owner();
    await diagnostic(c.property.reference, c.cookie, await testPdf()).expect(201);
    const previous = await h.prisma.propertyDocument.findFirstOrThrow();
    const replacement = await testPdf({ pages: 2 });
    await diagnostic(c.property.reference, c.cookie, replacement).expect(201);
    const current = await h.prisma.propertyDocument.findFirstOrThrow();
    expect(current.id).toBe(previous.id);
    expect(current.storageKey).not.toBe(previous.storageKey);
    expect((await read('private', current.storageKey)).equals(replacement)).toBe(true);
    await expect(read('private', previous.storageKey)).rejects.toThrow();
  });
  it('stocke une photo publique décodable sans ses métadonnées, puis la supprime', async () => {
    const c = await owner();
    const response = await api()
      .post(`/api/v1/owner/properties/${c.property.reference}/photos`)
      .set('Cookie', c.cookie)
      .attach('file', await testImage('jpeg', true), {
        filename: '../../original.html',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const photo = await h.prisma.propertyPhoto.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    expect(photo.storageKey).toMatch(/\/[a-f0-9-]+\.jpg$/);
    expect((await sharp(await read('public', photo.storageKey)).metadata()).exif).toBeUndefined();
    await api()
      .delete(`/api/v1/owner/properties/${c.property.reference}/photos/${photo.id}`)
      .set('Cookie', c.cookie)
      .expect(204);
    await expect(read('public', photo.storageKey)).rejects.toThrow();
  });
  it('ignore la taille déclarée par un appel interne et conserve la taille réelle', async () => {
    const bytes = await testPdf();
    const stored = await h.app
      .get(StorageService)
      .save(
        'private',
        'tests/size',
        { buffer: bytes, size: 1, mimetype: 'application/pdf', originalname: 'document.exe' },
        DOCUMENT_TYPES,
      );
    expect(stored.size).toBe(bytes.length);
    expect(stored.key).toMatch(/\.pdf$/);
    await h.app.get(StorageService).remove('private', stored.key);
  });
  it('ne laisse pas un nouveau fichier si la transaction métier échoue', async () => {
    const c = await tenant();
    const put = jest.spyOn(driver(), 'put');
    jest
      .spyOn(h.app.get(PayslipAnalysisService), 'enqueue')
      .mockRejectedValueOnce(new Error('Panne fictive après dépôt'));
    await tenantUpload(c.cookie, await testPdf()).expect(500);
    const key = put.mock.calls[0][1];
    await expect(read('private', key)).rejects.toThrow();
    expect(await h.prisma.tenantDocument.count()).toBe(0);
  });
});
