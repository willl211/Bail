import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createProperty, createUser, createVerifiedFile, TEST_PASSWORD } from './fixtures';
import { EVENT } from '../src/modules/mail/event.templates';
import { EventResolver } from '../src/modules/mail/event.resolver';
import { VisitReminders } from '../src/modules/visits/visit.reminders';
import { RecordingPurge } from '../src/modules/visits/recording.purge';
import { StorageService } from '../src/modules/storage/storage.service';
import { VIDEO_DRIVER, type VideoDriver } from '../src/modules/video/video.driver';
import { PAYMENT_DRIVER, type PaymentDriver } from '../src/modules/payments/payment.driver';

describe('Visites : calendrier, décisions, notifications et purge', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());
  const future = (minutes = 3 * 24 * 60) => new Date(Date.now() + minutes * 60_000);
  const login = async (email: string) =>
    sessionCookie(
      await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200),
    );
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
  });

  async function fixture() {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    const property = await createProperty(h.prisma, owner.id);
    const file = await createVerifiedFile(h.prisma, tenant.id);
    const application = await h.prisma.application.create({
      data: {
        propertyId: property.id,
        tenantId: tenant.id,
        tenantFileId: file.id,
        status: 'SHORTLISTED',
      },
    });
    const slot = await h.prisma.visitSlot.create({
      data: {
        propertyId: property.id,
        openedById: owner.id,
        startsAt: future(),
        allowedTypes: ['ACCOMPANIED'],
        durationMinutes: 30,
      },
    });
    return { owner, tenant, property, application, slot, cookie: await login(tenant.email) };
  }
  async function book(f: Awaited<ReturnType<typeof fixture>>, slotId = f.slot.id) {
    return api()
      .post(`/api/v1/tenant/visits/property/${f.property.reference}`)
      .set('Cookie', f.cookie)
      .send({ slotId, type: 'ACCOMPANIED' });
  }

  it('refuse deux créneaux différents réservés simultanément par le même locataire sur un bien', async () => {
    const f = await fixture();
    const other = await h.prisma.visitSlot.create({
      data: {
        propertyId: f.property.id,
        openedById: f.owner.id,
        startsAt: future(5000),
        allowedTypes: ['ACCOMPANIED'],
      },
    });
    const results = await Promise.all([book(f), book(f, other.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await h.prisma.visit.count()).toBe(1);
    expect(await h.prisma.emailMessage.count({ where: { template: EVENT.visitBooked } })).toBe(2);
  });

  it('refuse les chevauchements du locataire sur deux biens', async () => {
    const f = await fixture();
    expect((await book(f)).status).toBe(201);
    const property = await createProperty(h.prisma, f.owner.id);
    const file = await h.prisma.tenantFile.findUniqueOrThrow({ where: { tenantId: f.tenant.id } });
    await h.prisma.application.create({
      data: {
        propertyId: property.id,
        tenantId: f.tenant.id,
        tenantFileId: file.id,
        status: 'SHORTLISTED',
      },
    });
    const slot = await h.prisma.visitSlot.create({
      data: {
        propertyId: property.id,
        openedById: f.owner.id,
        startsAt: f.slot.startsAt,
        allowedTypes: ['ACCOMPANIED'],
      },
    });
    await api()
      .post(`/api/v1/tenant/visits/property/${property.reference}`)
      .set('Cookie', f.cookie)
      .send({ slotId: slot.id, type: 'ACCOMPANIED' })
      .expect(409);
  });

  it('ne ferme jamais un créneau réservé sous concurrence', async () => {
    const f = await fixture();
    const ownerCookie = await login(f.owner.email);
    const [reservation, closure] = await Promise.all([
      book(f),
      api()
        .delete(`/api/v1/owner/properties/${f.property.reference}/slots/${f.slot.id}`)
        .set('Cookie', ownerCookie),
    ]);
    expect([201, 404, 409]).toContain(reservation.status);
    expect([200, 409]).toContain(closure.status);
    const slot = await h.prisma.visitSlot.findUniqueOrThrow({ where: { id: f.slot.id } });
    expect(!!slot.visitId && !!slot.closedAt).toBe(false);
    expect(
      [reservation.status, closure.status].filter((status) => status >= 200 && status < 300),
    ).toHaveLength(1);
  });

  it('sérialise les ouvertures qui se chevauchent et permet de rouvrir un créneau fermé', async () => {
    const f = await fixture();
    const cookie = await login(f.owner.email);
    const path = `/api/v1/owner/properties/${f.property.reference}/slots`;
    const startsAt = future(6000);
    const responses = await Promise.all(
      [0, 15].map((offset) =>
        api()
          .post(path)
          .set('Cookie', cookie)
          .send({
            startsAt: [new Date(startsAt.getTime() + offset * 60_000).toISOString()],
            allowedTypes: ['ACCOMPANIED'],
          }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    await api()
      .delete(path + '/' + f.slot.id)
      .set('Cookie', cookie)
      .expect(200);
    await api()
      .post(path)
      .set('Cookie', cookie)
      .send({ startsAt: [f.slot.startsAt.toISOString()], allowedTypes: ['ACCOMPANIED'] })
      .expect(201);
    expect(
      (await h.prisma.visitSlot.findUniqueOrThrow({ where: { id: f.slot.id } })).closedAt,
    ).toBeNull();
  });

  it('annule une seule fois, libère le créneau et conserve la vérité bancaire', async () => {
    const f = await fixture();
    const result = await book(f);
    const id = result.body.visit.id;
    await h.prisma.visit.update({
      where: { id },
      data: {
        preauthorizationStatus: 'AUTHORIZED',
        preauthorizationReference: 'pi_test_pending_release',
      },
    });
    const cancel = () =>
      api()
        .delete(`/api/v1/tenant/visits/${id}`)
        .set('Cookie', f.cookie)
        .send({ reason: 'Indisponible' });
    const responses = await Promise.all([cancel(), cancel()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const visit = await h.prisma.visit.findUniqueOrThrow({ where: { id } });
    expect(visit.status).toBe('CANCELLED');
    expect(visit.preauthorizationStatus).toBe('AUTHORIZED');
    expect(
      (await h.prisma.visitSlot.findUniqueOrThrow({ where: { id: f.slot.id } })).visitId,
    ).toBeNull();
    expect(await h.prisma.emailMessage.count({ where: { template: EVENT.visitCancelled } })).toBe(
      2,
    );
    const resolver = h.app.get(EventResolver);
    expect(await resolver.resolve(EVENT.visitBooked, id, f.tenant.id)).toBeNull();
    const notice = await resolver.resolve(EVENT.visitCancelled, id, f.tenant.id);
    expect(notice?.message.text).toContain(`/biens/${f.property.reference}/visite`);
    expect((await book(f)).status).toBe(201);
    await cancel().expect(200);
    expect(
      (await h.prisma.application.findUniqueOrThrow({ where: { id: f.application.id } })).status,
    ).toBe('VISIT_SCHEDULED');
  });

  it('respecte le délai et masque les visites d’un autre locataire', async () => {
    const f = await fixture();
    const result = await book(f);
    const id = result.body.visit.id;
    const other = await createUser(h.prisma, UserRole.TENANT);
    await api()
      .delete(`/api/v1/tenant/visits/${id}`)
      .set('Cookie', await login(other.email))
      .send({})
      .expect(404);
    await h.prisma.visit.update({ where: { id }, data: { scheduledAt: future(120) } });
    await api().delete(`/api/v1/tenant/visits/${id}`).set('Cookie', f.cookie).send({}).expect(409);
    expect((await h.prisma.visit.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED');
  });

  it('refuse la visio simulée sans créer de visite ni exposer un ancien lien', async () => {
    const f = await fixture();
    await api()
      .post(`/api/v1/tenant/visits/property/${f.property.reference}`)
      .set('Cookie', f.cookie)
      .send({ slotId: f.slot.id, type: 'VIDEO' })
      .expect(503);
    expect(await h.prisma.visit.count()).toBe(0);
    const result = await book(f);
    await h.prisma.visit.update({
      where: { id: result.body.visit.id },
      data: { type: 'VIDEO', videoRoomUrl: 'https://private.invalid/secret' },
    });
    const list = await api().get('/api/v1/tenant/visits').set('Cookie', f.cookie).expect(200);
    expect(list.body[0].videoRoomUrl).toBeNull();
    const other = await createUser(h.prisma, UserRole.TENANT);
    expect(
      (
        await api()
          .get('/api/v1/tenant/visits')
          .set('Cookie', await login(other.email))
      ).body,
    ).toEqual([]);
  });

  it('réserve sans empreinte fictivement autorisée et notifie les deux parties', async () => {
    const f = await fixture();
    const result = await book(f);
    expect(result.status).toBe(201);
    expect(result.body.visit.preauthorizationStatus).toBe('NOT_REQUIRED');
    expect(result.body.visit.preauthorizationAmountCents).toBeNull();
    const resolver = h.app.get(EventResolver);
    const id = result.body.visit.id;
    expect((await resolver.resolve(EVENT.visitBooked, id, f.tenant.id))?.message.text).toContain(
      'affectation',
    );
    expect((await resolver.resolve(EVENT.visitBooked, id, f.owner.id))?.message.text).toContain(
      '/proprietaires/biens/',
    );
    const other = await createUser(h.prisma, UserRole.TENANT);
    expect(await resolver.resolve(EVENT.visitBooked, id, other.id)).toBeNull();
  });

  it('refuse une identité retirée ou une candidature écartée', async () => {
    const f = await fixture();
    await h.prisma.tenantDocument.updateMany({
      where: { tenantFile: { tenantId: f.tenant.id }, type: 'ID_CARD' },
      data: { status: 'REJECTED' },
    });
    expect((await book(f)).status).toBe(400);
    await h.prisma.tenantDocument.updateMany({
      where: { tenantFile: { tenantId: f.tenant.id }, type: 'ID_CARD' },
      data: { status: 'VERIFIED' },
    });
    await h.prisma.application.update({
      where: { id: f.application.id },
      data: { status: 'REJECTED' },
    });
    expect((await book(f)).status).toBe(409);
    expect(await h.prisma.visit.count()).toBe(0);
  });

  it('empêche deux affectations simultanées d’un agent sur des visites qui se chevauchent', async () => {
    const f = await fixture();
    const agent = await createUser(h.prisma, UserRole.AGENT);
    const cookie = await login(agent.email);
    const one = (await book(f)).body.visit.id as string;
    const other = await h.prisma.visit.create({
      data: {
        propertyId: f.property.id,
        tenantId: f.tenant.id,
        type: 'ACCOMPANIED',
        scheduledAt: f.slot.startsAt,
        status: 'CONFIRMED',
      },
    });
    const responses = await Promise.all(
      [one, other.id].map((id) =>
        api()
          .post(`/api/v1/admin/visits/${id}/assign`)
          .set('Cookie', cookie)
          .send({ agentId: agent.id }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await h.prisma.visit.count({ where: { agentId: agent.id } })).toBe(1);
    const assigned = await h.prisma.visit.findFirstOrThrow({ where: { agentId: agent.id } });
    await api()
      .post(`/api/v1/admin/visits/${assigned.id}/assign`)
      .set('Cookie', cookie)
      .send({ agentId: agent.id })
      .expect(200);
    expect(await h.prisma.emailMessage.count({ where: { template: EVENT.visitAssigned } })).toBe(2);
    expect(
      (await h.app.get(EventResolver).resolve(EVENT.visitAssigned, assigned.id, agent.id))?.message
        .text,
    ).toContain('/back-office');
  });

  it('prévient aussi l’ancien agent lors d’une réaffectation', async () => {
    const f = await fixture();
    const first = await createUser(h.prisma, UserRole.AGENT);
    const second = await createUser(h.prisma, UserRole.AGENT);
    const cookie = await login(first.email);
    const id = (await book(f)).body.visit.id;
    for (const agentId of [first.id, second.id]) {
      await api()
        .post(`/api/v1/admin/visits/${id}/assign`)
        .set('Cookie', cookie)
        .send({ agentId })
        .expect(200);
    }
    const resolver = h.app.get(EventResolver);
    expect(await resolver.resolve(EVENT.visitAssigned, id, first.id)).toBeNull();
    expect((await resolver.resolve(EVENT.visitUnassigned, id, first.id))?.message.text).toContain(
      'plus affecté',
    );
    expect(await resolver.resolve(EVENT.visitUnassigned, id, second.id)).toBeNull();
    expect(await h.prisma.emailMessage.count({ where: { template: EVENT.visitUnassigned } })).toBe(
      1,
    );
  });

  it('refus propriétaire concurrent à la réservation : aucune visite active ne subsiste', async () => {
    const f = await fixture();
    const ownerCookie = await login(f.owner.email);
    const [reserved, rejected] = await Promise.all([
      book(f),
      api()
        .post(`/api/v1/owner/applications/${f.application.id}/reject`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'Changement de projet' }),
    ]);
    expect([201, 409]).toContain(reserved.status);
    expect(rejected.status).toBe(200);
    expect(
      await h.prisma.visit.count({ where: { status: { in: ['CONFIRMED', 'PENDING_CHECKS'] } } }),
    ).toBe(0);
    expect(
      (await h.prisma.visitSlot.findUniqueOrThrow({ where: { id: f.slot.id } })).visitId,
    ).toBeNull();
  });

  it('ne réserve pas avec Stripe tant que le parcours d’empreinte est incomplet', async () => {
    const f = await fixture();
    const payment = h.app.get<PaymentDriver>(PAYMENT_DRIVER);
    const descriptor = Object.getOwnPropertyDescriptor(payment, 'name')!;
    Object.defineProperty(payment, 'name', { ...descriptor, value: 'stripe' });
    try {
      expect((await book(f)).status).toBe(503);
      expect(await h.prisma.visit.count()).toBe(0);
      expect(await h.prisma.payment.count()).toBe(0);
    } finally {
      Object.defineProperty(payment, 'name', descriptor);
    }
  });

  it('la suppression obligatoire tolère l’absence mais refuse une clé hors stockage', async () => {
    const storage = h.app.get(StorageService);
    await expect(
      storage.removeRequired('private', 'tests/absent-recording.mp4'),
    ).resolves.toBeUndefined();
    await expect(storage.removeRequired('private', '../outside')).rejects.toThrow();
  });

  it('refuse un agent désactivé et une visite terminée', async () => {
    const f = await fixture();
    const agent = await createUser(h.prisma, UserRole.AGENT);
    const cookie = await login(agent.email);
    const inactive = await createUser(h.prisma, UserRole.AGENT);
    await h.prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    const id = (await book(f)).body.visit.id;
    const assign = (agentId: string) =>
      api().post(`/api/v1/admin/visits/${id}/assign`).set('Cookie', cookie).send({ agentId });
    await assign(inactive.id).expect(400);
    await h.prisma.visit.update({ where: { id }, data: { status: 'NO_SHOW' } });
    await assign(agent.id).expect(409);
    await api()
      .post(`/api/v1/admin/visits/${id}/assign`)
      .set('Cookie', f.cookie)
      .send({ agentId: agent.id })
      .expect(403);
  });

  it('envoie un rappel unique et abandonne celui d’une visite annulée', async () => {
    const f = await fixture();
    const agent = await createUser(h.prisma, UserRole.AGENT);
    const id = (await book(f)).body.visit.id;
    await h.prisma.visit.update({
      where: { id },
      data: { scheduledAt: future(90), agentId: agent.id },
    });
    const reminders = h.app.get(VisitReminders);
    await Promise.all([reminders.remind(), reminders.remind()]);
    expect(await h.prisma.emailMessage.count({ where: { template: EVENT.visitReminder } })).toBe(2);
    expect(
      await h.app.get(EventResolver).resolve(EVENT.visitReminder, id, f.tenant.id),
    ).not.toBeNull();
    await h.prisma.visit.update({ where: { id }, data: { status: 'CANCELLED' } });
    expect(await h.app.get(EventResolver).resolve(EVENT.visitReminder, id, f.tenant.id)).toBeNull();
  });

  it('ne certifie pas une purge échouée et la reprend au passage suivant', async () => {
    const f = await fixture();
    const id = (await book(f)).body.visit.id;
    await h.prisma.visit.update({
      where: { id },
      data: { recordingStorageKey: 'tests/recording.mp4', recordingExpiresAt: new Date(0) },
    });
    const storage = h.app.get(StorageService);
    const original = storage.removeRequired;
    storage.removeRequired = async () => {
      throw new Error('Stockage indisponible');
    };
    try {
      await h.app.get(RecordingPurge).purge();
      const failed = await h.prisma.visit.findUniqueOrThrow({ where: { id } });
      expect(failed.recordingPurgedAt).toBeNull();
      expect(failed.recordingStorageKey).toBe('tests/recording.mp4');
      storage.removeRequired = async () => {};
      await h.app.get(RecordingPurge).purge();
      const done = await h.prisma.visit.findUniqueOrThrow({ where: { id } });
      expect(done.recordingPurgedAt).not.toBeNull();
      expect(done.recordingStorageKey).toBeNull();
    } finally {
      storage.removeRequired = original;
    }
  });

  it('ferme les salles annulées sans fichier local et reprend un échec du prestataire', async () => {
    const f = await fixture();
    const id = (await book(f)).body.visit.id;
    await h.prisma.visit.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        videoProvider: 'mock',
        videoRoomId: 'room-test',
        videoRoomUrl: 'https://test.invalid',
        recordingExpiresAt: future(20000),
      },
    });
    const video = h.app.get<VideoDriver>(VIDEO_DRIVER);
    const original = video.deleteRoom;
    video.deleteRoom = async () => {
      throw new Error('Prestataire indisponible');
    };
    try {
      await h.app.get(RecordingPurge).purge();
      expect(
        (await h.prisma.visit.findUniqueOrThrow({ where: { id } })).recordingPurgedAt,
      ).toBeNull();
      const removed: string[] = [];
      video.deleteRoom = async (roomId) => {
        removed.push(roomId);
      };
      await h.app.get(RecordingPurge).purge();
      expect(removed).toEqual(['room-test']);
      const done = await h.prisma.visit.findUniqueOrThrow({ where: { id } });
      expect(done.videoRoomId).toBeNull();
      expect(done.videoRoomUrl).toBeNull();
      expect(done.recordingPurgedAt).not.toBeNull();
    } finally {
      video.deleteRoom = original;
    }
  });
});
