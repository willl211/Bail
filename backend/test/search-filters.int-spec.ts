import request from 'supertest';
import { PropertyStatus, PropertyType, UserRole } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { TEST_PASSWORD, createProperty, createUser } from './fixtures';

describe('Filtres publics de recherche', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const samples = [
      { reference: 'APARTMENT-2', propertyType: PropertyType.APARTMENT, rooms: 2, rentCents: 80_000, chargesCents: 10_000, surfaceM2: 45 },
      { reference: 'HOUSE-4', propertyType: PropertyType.HOUSE, rooms: 4, rentCents: 85_000, chargesCents: 10_000, surfaceM2: 80 },
      { reference: 'HOUSE-5', propertyType: PropertyType.HOUSE, rooms: 5, rentCents: 70_000, chargesCents: 0, surfaceM2: 100 },
      { reference: 'UNKNOWN', propertyType: null, rooms: 2, rentCents: 60_000, chargesCents: 5_000, surfaceM2: 40 },
      { reference: 'HIDDEN', propertyType: PropertyType.HOUSE, rooms: 4, rentCents: 50_000, chargesCents: 0, surfaceM2: 90, status: PropertyStatus.DRAFT },
    ];
    for (const sample of samples) {
      const property = await createProperty(h.prisma, owner.id, { reference: sample.reference });
      await h.prisma.property.update({ where: { id: property.id }, data: sample });
    }
  });

  const references = async (query: Record<string, string | number | boolean> = {}) => {
    const response = await api().get('/api/v1/properties').query(query).expect(200);
    expect(response.body.total).toBe(response.body.items.length);
    return (response.body.items as { reference: string }[]).map((item) => item.reference).sort();
  };

  it('inclut les charges par défaut et accepte une limite exacte', async () => {
    expect(await references({ maxRent: 900 })).toEqual(['APARTMENT-2', 'HOUSE-5', 'UNKNOWN']);
    expect(await references({ maxRent: 900, includeCharges: true })).toEqual(['APARTMENT-2', 'HOUSE-5', 'UNKNOWN']);
    expect(await references({ maxRent: 900, includeCharges: false })).toEqual(['APARTMENT-2', 'HOUSE-4', 'HOUSE-5', 'UNKNOWN']);
  });

  it('applique aussi le mode hors charges à la borne minimum', async () => {
    expect(await references({ minRent: 850, maxRent: 900, includeCharges: false })).toEqual(['HOUSE-4']);
    expect(await references({ minRent: 850, maxRent: 900 })).toEqual(['APARTMENT-2']);
  });

  it('sépare les appartements des maisons sans deviner les types manquants', async () => {
    expect(await references({ propertyType: 'APARTMENT' })).toEqual(['APARTMENT-2']);
    expect(await references({ propertyType: 'HOUSE' })).toEqual(['HOUSE-4', 'HOUSE-5']);
    expect(await references()).toContain('UNKNOWN');
  });

  it('combine budget, type, pièces, surface, ameublement et quartier', async () => {
    expect(await references({ maxRent: 900, includeCharges: false, propertyType: 'HOUSE', minRooms: 4, minSurface: 75, furnished: 'unfurnished', districts: 'sablon' })).toEqual(['HOUSE-4', 'HOUSE-5']);
    expect(await references({ propertyType: 'HOUSE', minRooms: 4, maxRooms: 4 })).toEqual(['HOUSE-4']);
    expect(await references({ minRooms: 2, maxRooms: 2 })).toEqual(['APARTMENT-2', 'UNKNOWN']);
    expect(await references({ propertyType: 'HOUSE', minRooms: 2, maxRooms: 2 })).toEqual([]);
  });

  it.each([{ includeCharges: 'maybe' }, { includeCharges: '0' }, { propertyType: 'GARAGE' }, { minRooms: '0' }])('refuse un filtre invalide : %j', async (query) => {
    await api().get('/api/v1/properties').query(query).expect(400);
  });

  it('enregistre le type depuis le formulaire propriétaire et le restitue', async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const login = await api().post('/api/v1/auth/login').send({ email: owner.email, password: TEST_PASSWORD }).expect(200);
    const cookie = sessionCookie(login);
    const created = await api().post('/api/v1/owner/properties').set('Cookie', cookie).send({ title: 'Maison avec jardin', propertyType: 'HOUSE' }).expect(201);
    const url = `/api/v1/owner/properties/${created.body.reference}`;
    const detail = await api().get(url).set('Cookie', cookie).expect(200);
    expect(detail.body.propertyType).toBe('HOUSE');
    await api().patch(url).set('Cookie', cookie).send({ propertyType: 'APARTMENT' }).expect(200);
    expect((await api().get(url).set('Cookie', cookie).expect(200)).body.propertyType).toBe('APARTMENT');
    await api().patch(url).set('Cookie', cookie).send({ propertyType: 'GARAGE' }).expect(400);
  });
});
