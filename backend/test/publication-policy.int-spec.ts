import { jest } from '@jest/globals';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createProperty, createUser, TEST_PASSWORD } from './fixtures';
import { PublicationExpiryService } from '../src/modules/owner/publication-expiry.service';
import { SubscriptionService } from '../src/modules/payments/subscription.service';
import { visiblePropertyWhere } from '../src/modules/properties/property-visibility';
import { isCurrentDiagnostic } from '../src/modules/owner/property.checks';
import { LeaseService } from '../src/modules/lease/lease.service';
import { createLeaseTemplate, createVerifiedFile } from './fixtures';

describe('Publication : éligibilité, diagnostics et retrait', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());
  const login = async (email: string) => sessionCookie(await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200));
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { jest.restoreAllMocks(); await resetDatabase(h.prisma); });

  it.each(['G', 'EXPIRED', 'UNKNOWN', 'MISSING_GAS'])('ferme listes, fiche, candidature et visite pour %s', async (reason) => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    const cookie = await login(tenant.email);
    await api().get(`/api/v1/properties/${property.reference}`).expect(200);
    if (reason === 'G') await h.prisma.property.update({ where: { id: property.id }, data: { energyRating: 'G' } });
    if (reason === 'UNKNOWN') await h.prisma.property.update({ where: { id: property.id }, data: { riskDiagnostic: 'UNKNOWN' } });
    if (reason === 'MISSING_GAS') await h.prisma.property.update({ where: { id: property.id }, data: { gasDiagnostic: 'REQUIRED' } });
    if (reason === 'EXPIRED') await h.prisma.propertyDocument.updateMany({ where: { propertyId: property.id }, data: { expiresAt: new Date('2020-01-01') } });
    await api().get(`/api/v1/properties/${property.reference}`).expect(404);
    const list = await api().get('/api/v1/properties').expect(200);
    expect(list.body.total).toBe(0);
    await api().get(`/api/v1/tenant/applications/${property.reference}/preview`).set('Cookie', cookie).expect(404);
    await api().get(`/api/v1/tenant/visits/property/${property.reference}`).set('Cookie', cookie).expect(404);
    expect(await h.app.get(SubscriptionService).billableCount(owner.id)).toBe(0);
  });

  it('retire une fois, conserve le motif et reprend une synchronisation de facturation échouée', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    await h.prisma.propertyDocument.updateMany({ where: { propertyId: property.id }, data: { expiresAt: new Date('2020-01-01') } });
    const sync = jest.spyOn(h.app.get(SubscriptionService), 'syncQuantity').mockRejectedValueOnce(new Error('Indisponible')).mockResolvedValue(undefined);
    const worker = h.app.get(PublicationExpiryService);
    await worker.reconcile();
    const current = () => h.prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(await current()).toMatchObject({ status: 'DRAFT', reviewRevision: 2, publicationBillingSyncPending: true });
    expect((await current()).reviewNote).toContain('DPE à valider');
    await worker.reconcile();
    expect((await current()).publicationBillingSyncPending).toBe(false);
    expect(await h.prisma.propertyReviewEvent.count({ where: { propertyId: property.id } })).toBe(1);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(await h.prisma.propertyDocument.count({ where: { propertyId: property.id } })).toBe(1);
  });

  it('conserve les biens loués et bloque F exactement au changement de calendrier', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    await h.prisma.property.update({ where: { id: property.id }, data: { energyRating: 'F' } });
    expect(await h.prisma.property.count({ where: visiblePropertyWhere(new Date('2027-12-31T22:59:59.999Z')) })).toBe(1);
    expect(await h.prisma.property.count({ where: visiblePropertyWhere(new Date('2027-12-31T23:00:00Z')) })).toBe(0);
    await h.prisma.property.update({ where: { id: property.id }, data: { status: 'RENTED', energyRating: 'G' } });
    await h.app.get(PublicationExpiryService).reconcile();
    expect((await h.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).status).toBe('RENTED');
  });

  it('sauvegarde les réponses et invalide les diagnostics si leur contexte change', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    await h.prisma.property.update({ where: { id: property.id }, data: { status: 'DRAFT' } });
    const cookie = await login(owner.email);
    await api().patch(`/api/v1/owner/properties/${property.reference}`).set('Cookie', cookie).send({ gasDiagnostic: 'REQUIRED' }).expect(200);
    const row = await h.prisma.property.findUniqueOrThrow({ where: { id: property.id }, include: { documents: true } });
    expect(row.gasDiagnostic).toBe('REQUIRED');
    expect(row.documents[0].status).toBe('PENDING');
    const submit = await api().post(`/api/v1/owner/properties/${property.reference}/submit`).set('Cookie', cookie).expect(400);
    expect(submit.body.blockers).toContain('Gaz manquant');
    await api().patch(`/api/v1/owner/properties/${property.reference}`).set('Cookie', cookie).send({ gasDiagnostic: false }).expect(400);
  });

  it('applique le plafond calendaire même aux anciennes dates de fin trop lointaines', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    await h.prisma.property.update({ where: { id: property.id }, data: { riskDiagnostic: 'REQUIRED' } });
    const erp = await h.prisma.propertyDocument.create({ data: {
      propertyId: property.id, type: 'ERP', status: 'VERIFIED', storageKey: 'tests/erp.pdf',
      issuedAt: new Date('2026-08-31'), expiresAt: new Date('2099-01-01'),
    } });
    for (const [date, expected] of [['2027-02-27T23:59:59.999Z', true], ['2027-02-28T00:00:00Z', false]] as const) {
      const now = new Date(date);
      expect(isCurrentDiagnostic(erp, now)).toBe(expected);
      expect(await h.prisma.property.count({ where: { id: property.id, ...visiblePropertyWhere(now) } })).toBe(expected ? 1 : 0);
    }
  });

  it('exige le gaz dans le bail et recontrôle la classe au début prévu du bail', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    const file = await createVerifiedFile(h.prisma, tenant.id);
    const template = await createLeaseTemplate(h.prisma);
    const application = await h.prisma.application.create({ data: { propertyId: property.id, tenantId: tenant.id, tenantFileId: file.id } });
    await h.prisma.property.update({ where: { id: property.id }, data: { gasDiagnostic: 'REQUIRED', energyRating: 'F' } });
    const lease = await h.prisma.lease.create({ data: {
      reference: 'BAIL-POLICY', propertyId: property.id, tenantId: tenant.id, applicationId: application.id,
      templateId: template.id, templateChecksum: template.checksum, type: 'NU', status: 'DRAFT',
      fieldValues: {}, startDate: new Date('2028-01-01'), endDate: new Date('2031-01-01'),
      durationMonths: 36, rentCents: property.rentCents, chargesCents: property.chargesCents, depositCents: property.depositCents,
    } });
    const service = h.app.get(LeaseService);
    const view = await service.getByReference(lease.reference, owner.id, 'OWNER');
    expect(view.blockers.some((message) => message.startsWith('Gaz :'))).toBe(true);
    expect(view.blockers.some((message) => message.startsWith('Classe DPE F'))).toBe(true);
    expect(view.annexes.map((annex) => annex.type)).toEqual(['DPE', 'GAS']);
    await expect(service.sendForSignature(lease.reference, owner.id)).rejects.toThrow('Ce bail ne peut pas être envoyé');
    expect((await h.prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).signatureEnvelopeId).toBeNull();
  });
});
