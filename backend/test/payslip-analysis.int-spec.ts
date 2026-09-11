import { jest } from '@jest/globals';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createUser, TEST_PASSWORD } from './fixtures';
import { fictionalPayslipPdf, samplePayslip } from './payslip-fixtures';
import { PayslipAnalysisService } from '../src/modules/payslip-analysis/payslip-analysis.service';
import {
  DisabledPayslipDriver,
  type PayslipDriver,
} from '../src/modules/payslip-analysis/payslip.driver';
import {
  AnalysisFailure,
  type PayslipExtraction,
} from '../src/modules/payslip-analysis/payslip.schema';
import { AuthRateLimitService } from '../src/modules/auth/auth-rate-limit.service';

describe('Analyse des bulletins, du dépôt au contrôle admin', () => {
  let h: Harness;
  const analyze = jest.fn<PayslipDriver['analyze']>();
  const driver: PayslipDriver = { name: 'test', enabled: true, model: 'test-only', analyze };
  const api = () => request(h.app.getHttpServer());
  const worker = () => h.app.get(PayslipAnalysisService);
  const login = async (email: string) =>
    sessionCookie(
      await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200),
    );
  beforeAll(async () => {
    h = await createHarness({ payslipDriver: driver });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
    analyze.mockReset().mockResolvedValue(samplePayslip());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function ready() {
    const tenant = await createUser(h.prisma, 'TENANT');
    await h.prisma.user.update({
      where: { id: tenant.id },
      data: { firstName: 'Awa', lastName: 'Diallo' },
    });
    const agent = await createUser(h.prisma, 'AGENT');
    const file = await h.prisma.tenantFile.create({
      data: {
        tenantId: tenant.id,
        reference: `LOC-${tenant.id}`,
        status: 'SUBMITTED',
        contractType: 'CDI',
        employerName: 'Studio Sud',
        netMonthlyIncomeCents: 200000,
      },
    });
    const tenantCookie = await login(tenant.email),
      agentCookie = await login(agent.email);
    return { tenant, agent, file, tenantCookie, agentCookie };
  }
  async function upload(cookie: string, filename = 'specimen.pdf', bytes?: Buffer) {
    return api()
      .post('/api/v1/tenant/file/documents')
      .set('Cookie', cookie)
      .field('type', 'PAYSLIP')
      .attach('file', bytes ?? (await fictionalPayslipPdf()), {
        filename,
        contentType: 'application/pdf',
      })
      .expect(201);
  }
  async function setup() {
    const base = await ready();
    await upload(base.tenantCookie);
    const document = await h.prisma.tenantDocument.findFirstOrThrow({
      where: { tenantFileId: base.file.id },
    });
    return { ...base, document };
  }
  const read = (id: string, cookie: string, revision = 2) =>
    api().get(`/api/v1/admin/documents/${id}/analysis?revision=${revision}`).set('Cookie', cookie);

  it('retourne immédiatement après dépôt, puis conserve une aide privée sans valider la pièce', async () => {
    const { document, agentCookie, tenantCookie, file } = await setup();
    expect(analyze).not.toHaveBeenCalled();
    expect(document.status).toBe('PENDING');
    expect((await read(document.id, agentCookie).expect(200)).body.status).toBe('QUEUED');
    await worker().processNext();
    const review = await read(document.id, agentCookie).expect(200);
    expect(review.headers['cache-control']).toBe('private, no-store');
    expect(review.body.status).toBe('COMPLETED');
    expect(review.body.extraction.netBeforeTaxCents.value).toBe(200000);
    expect(review.body.checks.find((check: { code: string }) => check.code === 'INCOME').tone).toBe(
      'match',
    );
    const stored = await h.prisma.payslipAnalysis.findUniqueOrThrow({
      where: { documentId: document.id },
    });
    expect(stored.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.promptVersion).toBe('payslip-extraction-v1');
    expect(
      await h.prisma.tenantDocument.findUniqueOrThrow({ where: { id: document.id } }),
    ).toMatchObject({ status: 'PENDING', verifiedAt: null });
    expect(await h.prisma.tenantFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      revision: 2,
      netMonthlyIncomeCents: 200000,
      verifiedAt: null,
    });
    const tenant = await api().get('/api/v1/tenant/file').set('Cookie', tenantCookie).expect(200);
    expect(JSON.stringify(tenant.body)).not.toContain('extraction');
    expect(JSON.stringify(review.body)).not.toContain(document.storageKey!);
  });

  it('réserve les lectures et relances aux agents et exige la bonne version', async () => {
    const { document, tenantCookie, agentCookie } = await setup();
    const path = `/api/v1/admin/documents/${document.id}/analysis`;
    await api().get(`${path}?revision=2`).expect(401);
    await api().post(path).send({ expectedRevision: 2 }).expect(401);
    await read(document.id, tenantCookie).expect(403);
    await api().post(path).set('Cookie', tenantCookie).send({ expectedRevision: 2 }).expect(403);
    const owner = await createUser(h.prisma, 'OWNER');
    await read(document.id, await login(owner.email)).expect(403);
    await read(document.id, agentCookie, 1).expect(409);
    await api().post(path).set('Cookie', agentCookie).send({ expectedRevision: 1 }).expect(409);
    await api()
      .post(path)
      .set('Cookie', agentCookie)
      .send({ expectedRevision: 2, verified: true })
      .expect(400);
  });

  it('un seul worker prend le travail, même avec deux traitements simultanés', async () => {
    await setup();
    await Promise.all([worker().processNext(), worker().processNext()]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(await h.prisma.payslipAnalysis.count({ where: { status: 'COMPLETED' } })).toBe(1);
  });

  it('ne transmet pas un PDF invalide au fournisseur et garde le contrôle manuel', async () => {
    const { tenantCookie, agentCookie, file } = await ready();
    await upload(tenantCookie, 'invalide.pdf', Buffer.from('%PDF-1.4 faux fichier'));
    await worker().processNext();
    const document = await h.prisma.tenantDocument.findFirstOrThrow({
      where: { tenantFileId: file.id },
    });
    const view = await read(document.id, agentCookie).expect(200);
    expect(view.body.status).toBe('FAILED');
    expect(view.body.extraction).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
    expect(document.status).toBe('PENDING');
  });

  it('réessaie une panne transitoire trois fois au maximum', async () => {
    await setup();
    analyze.mockRejectedValue(new AnalysisFailure('PROVIDER_UNAVAILABLE', true));
    for (let attempt = 0; attempt < 3; attempt++) {
      await worker().processNext();
      await h.prisma.payslipAnalysis.updateMany({ data: { nextAttemptAt: new Date(0) } });
    }
    expect(await worker().processNext()).toBe(false);
    expect(analyze).toHaveBeenCalledTimes(3);
    expect(await h.prisma.payslipAnalysis.findFirstOrThrow()).toMatchObject({
      status: 'FAILED',
      attempts: 3,
      result: null,
    });
  });

  it('ignore le résultat d’un fichier retiré et ne l’attache jamais au remplaçant', async () => {
    const { document, tenantCookie } = await setup();
    let release!: (value: PayslipExtraction) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    analyze.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const running = worker().processNext();
    await started;
    try {
      await api()
        .delete(`/api/v1/tenant/file/documents/${document.id}`)
        .set('Cookie', tenantCookie)
        .expect(200);
      await upload(tenantCookie, 'remplacement.pdf');
    } finally {
      release(samplePayslip());
    }
    await running;
    expect(
      await h.prisma.payslipAnalysis.findUnique({ where: { documentId: document.id } }),
    ).toBeNull();
    const current = await h.prisma.payslipAnalysis.findFirstOrThrow();
    expect(current.documentId).not.toBe(document.id);
    expect(current).toMatchObject({ status: 'QUEUED', result: null });
  });

  it('conserve une décision humaine prise pendant la lecture IA', async () => {
    const { document, agentCookie } = await setup();
    let release!: (value: PayslipExtraction) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    analyze.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const running = worker().processNext();
    await started;
    try {
      await api()
        .post(`/api/v1/admin/documents/${document.id}/decision`)
        .set('Cookie', agentCookie)
        .send({
          expectedRevision: 2,
          decision: 'REJECT',
          reason: 'Pièce à remplacer après contrôle humain',
        })
        .expect(200);
    } finally {
      release(samplePayslip());
    }
    await running;
    expect(
      await h.prisma.tenantDocument.findUniqueOrThrow({ where: { id: document.id } }),
    ).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Pièce à remplacer après contrôle humain',
    });
  });

  it('recalcule les écarts sur la version courante du dossier, sans nouvel appel IA', async () => {
    const { document, tenantCookie, agentCookie } = await setup();
    await worker().processNext();
    await api()
      .patch('/api/v1/tenant/file')
      .set('Cookie', tenantCookie)
      .send({ netMonthlyIncomeCents: 300000 })
      .expect(200);
    const view = await read(document.id, agentCookie, 3).expect(200);
    expect(view.body.checks.find((check: { code: string }) => check.code === 'INCOME').tone).toBe(
      'attention',
    );
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('détecte les périodes en double entre les bulletins du même dossier', async () => {
    const { document, tenantCookie, agentCookie } = await setup();
    await upload(tenantCookie, 'doublon.pdf');
    await worker().processNext();
    await worker().processNext();
    const view = await read(document.id, agentCookie, 3).expect(200);
    expect(
      view.body.checks.some((check: { code: string }) => check.code === 'DUPLICATE_PERIOD'),
    ).toBe(true);
  });

  it('relance après panne avec une nouvelle génération, mais ne duplique pas les demandes en cours', async () => {
    const { document, agentCookie } = await setup();
    analyze.mockRejectedValueOnce(new AnalysisFailure('INVALID_RESULT'));
    await worker().processNext();
    const path = `/api/v1/admin/documents/${document.id}/analysis`;
    await api().post(path).set('Cookie', agentCookie).send({ expectedRevision: 2 }).expect(429);
    await h.prisma.payslipAnalysis.updateMany({ data: { requestedAt: new Date(0) } });
    await Promise.all(
      [0, 1].map(() =>
        api().post(path).set('Cookie', agentCookie).send({ expectedRevision: 2 }).expect(201),
      ),
    );
    expect(await h.prisma.payslipAnalysis.findFirstOrThrow()).toMatchObject({
      generation: 2,
      status: 'QUEUED',
    });
    await worker().processNext();
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('reprend un travail abandonné après expiration du verrou', async () => {
    await setup();
    await h.prisma.payslipAnalysis.updateMany({
      data: { status: 'PROCESSING', runToken: 'abandoned', attempts: 1, lockedUntil: new Date(0) },
    });
    await worker().processNext();
    expect(await h.prisma.payslipAnalysis.findFirstOrThrow()).toMatchObject({
      status: 'COMPLETED',
      attempts: 2,
    });
  });

  it('permet de relancer un résultat stocké devenu inexploitable', async () => {
    const { document, agentCookie } = await setup();
    await worker().processNext();
    await h.prisma.payslipAnalysis.updateMany({
      data: { result: { invalid: true }, requestedAt: new Date(0) },
    });
    const view = await read(document.id, agentCookie).expect(200);
    expect(view.body).toMatchObject({ status: 'FAILED', canRequest: true, extraction: null });
    await api()
      .post(`/api/v1/admin/documents/${document.id}/analysis`)
      .set('Cookie', agentCookie)
      .send({ expectedRevision: 2 })
      .expect(201);
    await worker().processNext();
    expect(analyze).toHaveBeenCalledTimes(2);
    expect((await read(document.id, agentCookie).expect(200)).body.status).toBe('COMPLETED');
  });

  it('un ancien worker ne peut pas écraser le résultat de celui qui a repris son travail', async () => {
    await setup();
    let release!: (value: PayslipExtraction) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    analyze.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const old = worker().processNext();
    await started;
    await h.prisma.payslipAnalysis.updateMany({ data: { lockedUntil: new Date(0) } });
    try {
      await worker().processNext();
    } finally {
      const outdated = samplePayslip();
      outdated.employeeName.value = 'Résultat obsolète';
      release(outdated);
    }
    await old;
    const current = await h.prisma.payslipAnalysis.findFirstOrThrow();
    expect((current.result as unknown as PayslipExtraction).employeeName.value).toBe('Awa Diallo');
  });

  it('diffère le traitement quand le quota fournisseur est épuisé', async () => {
    const { tenant } = await setup();
    const limiter = h.app.get(AuthRateLimitService);
    for (let i = 0; i < 10; i++)
      await limiter.consume({
        scope: 'payslip:provider:tenant',
        subject: tenant.id,
        limit: 10,
        windowSeconds: 86400,
      });
    await worker().processNext();
    expect(analyze).not.toHaveBeenCalled();
    expect(await h.prisma.payslipAnalysis.findFirstOrThrow()).toMatchObject({
      status: 'QUEUED',
      errorCode: 'DAILY_LIMIT',
      attempts: 0,
    });
    expect(await worker().processNext()).toBe(false);
  });

  it('masque un ancien résultat dont la source ne correspond plus', async () => {
    const { document, agentCookie } = await setup();
    await worker().processNext();
    await h.prisma.payslipAnalysis.updateMany({ data: { sourceStorageKey: 'source-obsolete' } });
    const view = await read(document.id, agentCookie).expect(200);
    expect(view.body).toMatchObject({ status: 'FAILED', extraction: null, checks: [] });
  });

  it('rejette une sortie falsifiée du prestataire sans changer le statut de la pièce', async () => {
    const { document } = await setup();
    analyze.mockResolvedValueOnce({ verified: true } as unknown as PayslipExtraction);
    await worker().processNext();
    expect(await h.prisma.payslipAnalysis.findFirstOrThrow()).toMatchObject({
      status: 'FAILED',
      result: null,
      errorCode: 'INVALID_RESULT',
    });
    expect(
      (await h.prisma.tenantDocument.findUniqueOrThrow({ where: { id: document.id } })).status,
    ).toBe('PENDING');
  });

  it('ne conserve pas une analyse si la transaction de dépôt échoue', async () => {
    const { tenantCookie } = await ready();
    jest.spyOn(worker(), 'enqueue').mockImplementation(async (tx, document, actor) => {
      await tx.payslipAnalysis.create({
        data: {
          documentId: document.id,
          status: 'QUEUED',
          provider: 'test',
          promptVersion: 'test',
          sourceStorageKey: document.storageKey!,
          sourceCreatedAt: document.createdAt,
          requestedById: actor,
          result: Prisma.DbNull,
        },
      });
      throw new Error('Test de panne après mise en file');
    });
    await api()
      .post('/api/v1/tenant/file/documents')
      .set('Cookie', tenantCookie)
      .field('type', 'PAYSLIP')
      .attach('file', await fictionalPayslipPdf(), {
        filename: 'rollback.pdf',
        contentType: 'application/pdf',
      })
      .expect(500);
    expect(await h.prisma.tenantDocument.count()).toBe(0);
    expect(await h.prisma.payslipAnalysis.count()).toBe(0);
  });
});

describe('Analyse désactivée sans prestataire', () => {
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
  it('conserve le bulletin en contrôle humain et n’appelle aucun fournisseur', async () => {
    const tenant = await createUser(h.prisma, 'TENANT');
    const service = h.app.get(PayslipAnalysisService);
    const fake = jest.spyOn(DisabledPayslipDriver.prototype, 'analyze');
    const file = await h.prisma.tenantFile.create({
      data: { tenantId: tenant.id, reference: `LOC-${tenant.id}`, status: 'SUBMITTED' },
    });
    const login = await request(h.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tenant.email, password: TEST_PASSWORD })
      .expect(200);
    await request(h.app.getHttpServer())
      .post('/api/v1/tenant/file/documents')
      .set('Cookie', sessionCookie(login))
      .field('type', 'PAYSLIP')
      .attach('file', await fictionalPayslipPdf(), {
        filename: 'specimen.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(await service.processNext()).toBe(false);
    expect(fake).not.toHaveBeenCalled();
    fake.mockRestore();
    expect(await h.prisma.payslipAnalysis.findFirstOrThrow()).toMatchObject({
      status: 'UNAVAILABLE',
      result: null,
    });
    expect(
      await h.prisma.tenantDocument.findFirstOrThrow({ where: { tenantFileId: file.id } }),
    ).toMatchObject({ status: 'PENDING', verifiedAt: null });
  });
});
