import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { createLeaseTemplate, createProperty, createUser, createVerifiedFile, TEST_PASSWORD } from './fixtures';
import { MockPaymentDriver } from '../src/modules/payments/mock-payment.driver';
import { StripePaymentDriver } from '../src/modules/payments/stripe-payment.driver';
import { SubscriptionService } from '../src/modules/payments/subscription.service';
import type { CheckoutInput, DriverCheckout, DriverSubscription } from '../src/modules/payments/payment.driver';

const secret = 'whsec_local_test_only';
const sdk = new Stripe('sk_test_local_only');
const stripeDriver = () => new StripePaymentDriver(new ConfigService({ integrations: { payment: { stripe: {
  secretKey: 'sk_test_local_only', productId: 'prod_local', webhookSecret: secret,
} } } }));

/** Réseau Stripe remplacé ; vraie signature, vrai serveur et vraie base isolée. */
class SandboxDriver extends MockPaymentDriver {
  override readonly name = 'stripe';
  sessions = new Map<string, DriverCheckout>();
  inputs = new Map<string, CheckoutInput>();
  remoteSubscriptions = new Map<string, DriverSubscription>();
  invoices = new Map<string, Record<string, unknown>>();
  failAfterCreation = false;
  resumeFails = false;
  resumed: string[] = [];
  override async createCheckout(input: CheckoutInput, key: string) {
    const id = `cs_test_${key}`;
    if (!this.sessions.has(id)) {
      this.inputs.set(key, input);
      this.sessions.set(id, { id, checkoutId: key, url: `https://checkout.stripe.com/c/pay/${id}`,
        status: 'open', mode: input.mode, amountCents: input.mode === 'setup' ? null : input.amountCents * input.quantity,
        currency: input.mode === 'setup' ? null : 'eur', paid: false, paymentIntentId: null,
        subscriptionId: null, customerId: 'cus_test', setupIntentId: input.mode === 'setup' ? 'seti_test' : null,
      });
    }
    if (this.failAfterCreation) { this.failAfterCreation = false; throw new Error('Réponse réseau perdue'); }
    return { ...this.sessions.get(id)! };
  }
  override async retrieveCheckout(id: string) { return { ...this.sessions.get(id)! }; }
  override parseWebhook(payload: Buffer, signature?: string) { return stripeDriver().parseWebhook(payload, signature); }
  override async subscriptionFromCheckout(session: DriverCheckout, input: CheckoutInput) {
    const subscription: DriverSubscription = { id: `sub_${input.resourceId}`, customerId: session.customerId!,
      status: 'active', currentPeriodEnd: new Date('2026-10-14'), quantity: input.quantity,
      localSubscriptionId: input.resourceId, cancelledAt: null,
    };
    this.remoteSubscriptions.set(subscription.id, subscription);
    return subscription;
  }
  override async retrieveSubscription(id: string) { return { ...this.remoteSubscriptions.get(id)! }; }
  override async retrieveInvoice(id: string) { return { ...this.invoices.get(id)! }; }
  override async resumeSubscription(id: string) {
    if (this.resumeFails) throw new Error('Stripe indisponible');
    this.resumed.push(id);
    const value = this.remoteSubscriptions.get(id)!; value.cancelledAt = null; return { ...value };
  }
  override async createPortal(_id: string, _url: string) { return { url: 'https://billing.stripe.com/p/session/test' }; }
}

describe('Paiements hébergés', () => {
  let h: Harness;
  const driver = new SandboxDriver();
  const api = () => request(h.app.getHttpServer());
  const login = async (email: string) => sessionCookie(await api().post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200));
  const notify = (type: string, object: object, id = 'evt_test') => {
    const payload = JSON.stringify({ id, type, livemode: false, data: { object } });
    return api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json')
      .set('stripe-signature', sdk.webhooks.generateTestHeaderString({ payload, secret })).send(payload);
  };
  const complete = (key: string) => {
    const session = driver.sessions.get(`cs_test_${key}`)!;
    Object.assign(session, { status: 'complete', paid: true, paymentIntentId: session.mode === 'payment' ? `pi_${key}` : null });
    return session;
  };
  beforeAll(async () => { h = await createHarness({ paymentDriver: driver }); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
    driver.sessions.clear(); driver.inputs.clear(); driver.remoteSubscriptions.clear(); driver.invoices.clear();
    driver.failAfterCreation = false; driver.resumeFails = false; driver.resumed = [];
    await h.prisma.feeSchedule.create({ data: { code: 'TEST-ONLY', label: 'Barème fictif de test', isActive: true, isLegallyApproved: true,
      effectiveFrom: new Date('2026-01-01'), tenantVisitFeeCentsPerSqm: 500, tenantInventoryFeeCentsPerSqm: 200, ownerSubscriptionMonthlyCents: 3900,
    } });
  });
  const feesFixture = async () => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    const property = await createProperty(h.prisma, owner.id);
    const file = await createVerifiedFile(h.prisma, tenant.id);
    const template = await createLeaseTemplate(h.prisma);
    const application = await h.prisma.application.create({ data: { propertyId: property.id, tenantId: tenant.id, tenantFileId: file.id } });
    const lease = await h.prisma.lease.create({ data: {
      reference: 'BAIL-TEST', propertyId: property.id, tenantId: tenant.id, applicationId: application.id,
      templateId: template.id, templateChecksum: template.checksum, type: 'NU', status: 'SIGNED', fieldValues: {},
      startDate: new Date('2026-10-01'), endDate: new Date('2029-10-01'), durationMonths: 36, rentCents: 80000, chargesCents: 5000, depositCents: 80000,
    } });
    const cookie = await login(tenant.email);
    const url = `/api/v1/tenant/leases/${lease.reference}/fees`;
    return { tenant, owner, lease, cookie, url };
  };
  const startFees = async () => {
    const fixture = await feesFixture();
    await api().post(fixture.url).set('Cookie', fixture.cookie).expect(200);
    const flow = await h.prisma.paymentCheckout.findFirstOrThrow();
    return { ...fixture, flow };
  };
  const startSubscription = async (withProperty = true) => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    if (withProperty) await createProperty(h.prisma, owner.id);
    const cookie = await login(owner.email);
    await api().post('/api/v1/owner/subscription').set('Cookie', cookie).expect(201);
    const flow = await h.prisma.paymentCheckout.findFirstOrThrow();
    return { owner, cookie, flow };
  };

  it('un double clic concurrent produit un seul règlement et la même session', async () => {
    const { cookie, url } = await feesFixture();
    const responses = await Promise.all([api().post(url).set('Cookie', cookie), api().post(url).set('Cookie', cookie)]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(responses[0].body.checkoutUrl).toBe(responses[1].body.checkoutUrl);
    expect(await h.prisma.payment.count()).toBe(1);
    expect(driver.sessions.size).toBe(1);
    expect((await h.prisma.payment.findFirstOrThrow()).status).toBe('PENDING');
    expect([...driver.inputs.values()][0].successUrl).toContain('/baux/BAIL-TEST/honoraires');
  });

  it('reprend la même tentative après une réponse Stripe perdue', async () => {
    const { cookie, url } = await feesFixture(); driver.failAfterCreation = true;
    await api().post(url).set('Cookie', cookie).expect(500);
    await api().post(url).set('Cookie', cookie).expect(200);
    expect(driver.sessions.size).toBe(1); expect(await h.prisma.payment.count()).toBe(1);
  });

  it('refuse une nouvelle création incertaine au-delà de la rétention de la clé', async () => {
    const { cookie, url, flow } = await startFees();
    await h.prisma.paymentCheckout.update({ where: { id: flow.id }, data: { providerSessionId: null, createdAt: new Date(Date.now() - 25 * 3600_000) } });
    await api().post(url).set('Cookie', cookie).expect(409);
    expect(driver.sessions.size).toBe(1);
  });

  it('confirme une seule fois malgré les notifications concurrentes et en retard', async () => {
    const { flow, cookie, url } = await startFees(); complete(flow.id);
    const event = { id: `cs_test_${flow.id}`, metadata: { checkoutId: flow.id } };
    await Promise.all([notify('checkout.session.completed', event).expect(200), notify('checkout.session.completed', event).expect(200)]);
    const first = await h.prisma.payment.findFirstOrThrow(); expect(first.status).toBe('PAID');
    await notify('payment_intent.payment_failed', { metadata: { checkoutId: flow.id } }).expect(200);
    expect((await h.prisma.payment.findFirstOrThrow()).paidAt).toEqual(first.paidAt);
    await api().post(url).set('Cookie', cookie).expect(409);
  });

  it('refuse une notification sans signature et un événement réel', async () => {
    await api().post('/api/v1/payments/webhook').send({ type: 'invoice.paid' }).expect(400);
    const payload = JSON.stringify({ id: 'evt_live', type: 'invoice.paid', livemode: true, data: { object: {} } });
    await api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json')
      .set('stripe-signature', sdk.webhooks.generateTestHeaderString({ payload, secret })).send(payload).expect(400);
  });

  it('ne valide pas un montant ou une session appartenant à une autre tentative', async () => {
    const { flow } = await startFees(); const session = complete(flow.id); session.amountCents = 1;
    await notify('checkout.session.completed', { id: session.id, metadata: { checkoutId: flow.id } }).expect(400);
    session.amountCents = 47600; session.checkoutId = 'autre';
    await notify('checkout.session.completed', { id: session.id, metadata: { checkoutId: flow.id } }).expect(400);
    expect((await h.prisma.payment.findFirstOrThrow()).status).toBe('PENDING');
  });

  it('ne prend pas le retour du navigateur pour une preuve de paiement', async () => {
    const { cookie, url } = await startFees();
    const result = await api().get(`${url}?paiement=retour`).set('Cookie', cookie).expect(200);
    expect(result.body.payment.status).toBe('PENDING');
  });

  it('affiche un refus de carte et permet de réessayer dans la même session', async () => {
    const { cookie, url, flow } = await startFees();
    await notify('payment_intent.payment_failed', { metadata: { checkoutId: flow.id } }).expect(200);
    expect((await h.prisma.payment.findFirstOrThrow()).status).toBe('FAILED');
    await api().post(url).set('Cookie', cookie).expect(200); expect(driver.sessions.size).toBe(1);
    complete(flow.id);
    await notify('checkout.session.completed', { id: `cs_test_${flow.id}`, metadata: { checkoutId: flow.id } }).expect(200);
    expect((await h.prisma.payment.findFirstOrThrow()).status).toBe('PAID');
  });

  it('renouvelle uniquement après une expiration confirmée par Stripe', async () => {
    const { cookie, url, flow } = await startFees();
    driver.sessions.get(`cs_test_${flow.id}`)!.status = 'expired';
    await api().post(url).set('Cookie', cookie).expect(409);
    await api().post(url).set('Cookie', cookie).expect(200);
    expect(await h.prisma.payment.count({ where: { status: 'PENDING' } })).toBe(1);
    expect(await h.prisma.payment.count({ where: { status: 'CANCELLED' } })).toBe(1);
  });

  it('conserve le prix des honoraires déjà ouverts quand le barème ou le bien change', async () => {
    const { cookie, url, lease } = await startFees();
    await h.prisma.property.update({ where: { id: lease.propertyId }, data: { surfaceM2: 80 } });
    await h.prisma.feeSchedule.updateMany({ data: { isActive: false } });
    await h.prisma.feeSchedule.create({ data: { code: 'NEW-TEST', label: 'Autre barème fictif', effectiveFrom: new Date(),
      isActive: true, isLegallyApproved: true, tenantVisitFeeCentsPerSqm: 600, tenantInventoryFeeCentsPerSqm: 300,
    } });
    const result = await api().get(url).set('Cookie', cookie).expect(200);
    expect(result.body.totalCents).toBe(47600); expect(result.body.surfaceM2).toBe(68);
    await api().post(url).set('Cookie', cookie).expect(200); expect(driver.sessions.size).toBe(1);
  });

  it('expire aussi une tentative dont la carte avait été refusée', async () => {
    const { cookie, url, flow } = await startFees();
    await notify('payment_intent.payment_failed', { metadata: { checkoutId: flow.id } }).expect(200);
    driver.sessions.get(`cs_test_${flow.id}`)!.status = 'expired';
    await notify('checkout.session.expired', { id: `cs_test_${flow.id}`, metadata: { checkoutId: flow.id } }).expect(200);
    expect((await h.prisma.payment.findFirstOrThrow()).status).toBe('CANCELLED');
    await api().post(url).set('Cookie', cookie).expect(200);
  });

  it('réouvre une souscription abandonnée seulement après expiration', async () => {
    const { cookie, flow } = await startSubscription(false);
    driver.sessions.get(`cs_test_${flow.id}`)!.status = 'expired';
    await api().post('/api/v1/owner/subscription').set('Cookie', cookie).expect(409);
    await api().post('/api/v1/owner/subscription').set('Cookie', cookie).expect(201);
    expect(await h.prisma.subscription.count({ where: { status: 'INCOMPLETE' } })).toBe(1);
    expect(await h.prisma.subscription.count({ where: { status: 'CANCELLED' } })).toBe(1);
  });

  it('conserve les contrôles du bail, du barème et de l’accès au compte', async () => {
    const { cookie, url, lease } = await feesFixture();
    const other = await createUser(h.prisma, UserRole.TENANT);
    await api().post(url).set('Cookie', await login(other.email)).expect(404);
    await h.prisma.lease.update({ where: { id: lease.id }, data: { status: 'DRAFT' } });
    await api().post(url).set('Cookie', cookie).expect(400);
    await h.prisma.lease.update({ where: { id: lease.id }, data: { status: 'SIGNED' } });
    await h.prisma.feeSchedule.updateMany({ data: { isLegallyApproved: false } });
    await api().post(url).set('Cookie', cookie).expect(400);
    expect(driver.sessions.size).toBe(0);
  });

  it.each([true, false])('souscription avec biens=%s : inactive avant confirmation et carte sans débit si zéro bien', async withProperty => {
    const { owner, cookie, flow } = await startSubscription(withProperty);
    expect((await h.prisma.subscription.findFirstOrThrow()).status).toBe('INCOMPLETE');
    expect(driver.inputs.get(flow.id)!.mode).toBe(withProperty ? 'subscription' : 'setup');
    await api().post('/api/v1/owner/subscription').set('Cookie', cookie).expect(201);
    expect(driver.sessions.size).toBe(1);
    complete(flow.id);
    await notify('checkout.session.completed', { id: `cs_test_${flow.id}`, metadata: { checkoutId: flow.id } }).expect(200);
    const subscription = await h.prisma.subscription.findFirstOrThrow({ where: { ownerId: owner.id } });
    expect(subscription.status).toBe('ACTIVE');
    expect(driver.remoteSubscriptions.get(subscription.stripeSubscriptionId!)!.quantity).toBe(withProperty ? 1 : 0);
    expect((await api().get('/api/v1/owner/subscription').set('Cookie', cookie)).body.paymentMethod).toBeNull();
    await api().post('/api/v1/owner/subscription').set('Cookie', cookie).expect(409);
    await api().post('/api/v1/owner/subscription/portal').set('Cookie', cookie).expect(200);
  });

  it('enregistre une facture payée même reçue avant invoice.created et ne la rétrograde pas', async () => {
    const { flow, owner } = await startSubscription(); const input = driver.inputs.get(flow.id)!;
    const remote = await driver.subscriptionFromCheckout(complete(flow.id), input);
    driver.invoices.set('in_test', { id: 'in_test', parent: { subscription_details: { subscription: remote.id } }, customer: remote.customerId,
      currency: 'eur', amount_paid: 3900, amount_due: 3900, status: 'paid', attempted: true, lines: { data: [{ quantity: 1 }] },
    });
    await notify('invoice.paid', { id: 'in_test' }).expect(200);
    await notify('invoice.created', { id: 'in_test' }).expect(200);
    await notify('invoice.payment_failed', { id: 'in_test' }).expect(200);
    expect(await h.prisma.payment.count()).toBe(1);
    expect((await h.prisma.payment.findFirstOrThrow()).status).toBe('PAID');
    expect((await h.prisma.subscription.findFirstOrThrow({ where: { ownerId: owner.id } })).status).toBe('ACTIVE');
  });

  it('notifie une seule fois l’échec de facture, puis accepte son paiement', async () => {
    const { flow } = await startSubscription(); const input = driver.inputs.get(flow.id)!;
    const remote = await driver.subscriptionFromCheckout(complete(flow.id), input);
    remote.status = 'past_due'; driver.remoteSubscriptions.set(remote.id, remote);
    const invoice = { id: 'in_fail', parent: { subscription_details: { subscription: remote.id } }, customer: remote.customerId,
      currency: 'eur', amount_paid: 0, amount_due: 3900, status: 'open', attempted: true, lines: { data: [{ quantity: 1 }] },
    };
    driver.invoices.set('in_fail', invoice);
    await Promise.all([notify('invoice.payment_failed', { id: invoice.id }).expect(200), notify('invoice.payment_failed', { id: invoice.id }).expect(200)]);
    expect(await h.prisma.emailMessage.count()).toBe(1);
    invoice.status = 'paid'; invoice.amount_paid = 3900; remote.status = 'active';
    await notify('invoice.paid', { id: invoice.id }).expect(200);
    expect((await h.prisma.payment.findFirstOrThrow()).status).toBe('PAID');
  });

  it('la reprise attend la réussite de l’annulation de résiliation chez Stripe', async () => {
    const { cookie, flow } = await startSubscription(); complete(flow.id);
    await notify('checkout.session.completed', { id: `cs_test_${flow.id}`, metadata: { checkoutId: flow.id } }).expect(200);
    await h.prisma.subscription.update({ where: { id: flow.resourceId }, data: { cancelledAt: new Date() } });
    driver.resumeFails = true;
    await api().post('/api/v1/owner/subscription/resume').set('Cookie', cookie).expect(500);
    expect((await h.prisma.subscription.findFirstOrThrow()).cancelledAt).not.toBeNull();
    driver.resumeFails = false;
    await api().post('/api/v1/owner/subscription/resume').set('Cookie', cookie).expect(200);
    expect(driver.resumed).toHaveLength(1);
    expect((await h.prisma.subscription.findFirstOrThrow()).cancelledAt).toBeNull();
  });

  it('exige un abonnement activé pour publier, puis retire les annonces à sa fin effective', async () => {
    const { owner, flow } = await startSubscription();
    const check = () => h.prisma.$transaction(tx => h.app.get(SubscriptionService).assertPublicationAllowed(tx, owner.id));
    await expect(check()).rejects.toThrow(/finaliser/);
    complete(flow.id);
    await notify('checkout.session.completed', { id: `cs_test_${flow.id}`, metadata: { checkoutId: flow.id } }).expect(200);
    await expect(check()).resolves.toBeUndefined();
    const remote = driver.remoteSubscriptions.get(`sub_${flow.resourceId}`)!;
    remote.cancelledAt = new Date('2026-10-14');
    await notify('customer.subscription.updated', { id: remote.id }).expect(200);
    expect(await h.prisma.property.count({ where: { ownerId: owner.id, status: 'ONLINE' } })).toBe(1);
    remote.status = 'canceled';
    await notify('customer.subscription.deleted', { id: remote.id }).expect(200);
    await notify('customer.subscription.deleted', { id: remote.id }).expect(200);
    expect(await h.prisma.property.count({ where: { ownerId: owner.id, status: 'ONLINE' } })).toBe(0);
    expect(await h.prisma.propertyReviewEvent.count({ where: { action: 'PUBLICATION_SUSPENDED' } })).toBe(1);
    await expect(check()).rejects.toThrow(/finaliser/);
  });

  it('une résiliation ancienne ne retire pas les annonces d’un nouvel abonnement actif', async () => {
    const { owner, flow } = await startSubscription(); complete(flow.id);
    await notify('checkout.session.completed', { id: `cs_test_${flow.id}`, metadata: { checkoutId: flow.id } }).expect(200);
    await h.prisma.subscription.create({ data: { ownerId: owner.id, status: 'ACTIVE', monthlyAmountCents: 3900, stripeSubscriptionId: 'sub_new' } });
    const remote = driver.remoteSubscriptions.get(`sub_${flow.resourceId}`)!; remote.status = 'canceled';
    await notify('customer.subscription.deleted', { id: remote.id }).expect(200);
    expect(await h.prisma.property.count({ where: { ownerId: owner.id, status: 'ONLINE' } })).toBe(1);
  });
});

describe('Notifications simulées', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); await resetDatabase(h.prisma); });
  afterAll(async () => { await h.close(); });
  it('refuse les anonymes et les propriétaires, accepte un agent connecté', async () => {
    const api = () => request(h.app.getHttpServer());
    await api().post('/api/v1/payments/webhook').send({ type: 'ignored' }).expect(403);
    for (const role of [UserRole.OWNER, UserRole.AGENT]) {
      const user = await createUser(h.prisma, role);
      const cookie = sessionCookie(await api().post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200));
      await api().post('/api/v1/payments/webhook').set('Cookie', cookie).send({ type: 'ignored' }).expect(role === 'AGENT' ? 200 : 403);
    }
  });
});

describe('Contrat envoyé au SDK Stripe', () => {
  it('refuse une clé réelle dès le démarrage', () => {
    expect(() => new StripePaymentDriver(new ConfigService({ integrations: { payment: { stripe: {
      secretKey: 'sk_live_interdit', productId: 'prod_test', webhookSecret: secret,
    } } } }))).toThrow(/sandbox/);
  });

  it('ouvre Checkout avec clé stable, montant serveur et métadonnées de rapprochement', async () => {
    const driver = stripeDriver(); const calls: unknown[][] = [];
    Reflect.set(driver, 'stripe', { checkout: { sessions: { create: async (...args: unknown[]) => {
      calls.push(args); return { id: 'cs_test', status: 'open', mode: 'payment', metadata: { checkoutId: 'key' }, url: 'https://checkout.stripe.com/test' };
    } } } });
    await driver.createCheckout({ mode: 'payment', amountCents: 12300, quantity: 1, userId: 'u', resourceId: 'p', email: 'test@bail.test',
      label: 'Honoraires', successUrl: 'http://localhost:3000/retour', cancelUrl: 'http://localhost:3000/retour', expiresAt: 2000000000,
    }, 'key');
    expect(calls[0]).toEqual([expect.objectContaining({ mode: 'payment', payment_method_types: ['card'],
      payment_intent_data: { metadata: { checkoutId: 'key', paymentId: 'p' } },
      line_items: [expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ unit_amount: 12300, currency: 'eur' }) })],
    }), { idempotencyKey: 'checkout:key' }]);
  });

  it('la reprise Stripe envoie explicitement cancel_at_period_end=false', async () => {
    const driver = stripeDriver(); let sent: unknown;
    Reflect.set(driver, 'stripe', { subscriptions: { update: async (_id: string, data: unknown) => {
      sent = data; return { id: 'sub_test', customer: 'cus_test', status: 'active', metadata: {}, items: { data: [{ current_period_end: 2000000000, quantity: 1 }] } };
    } } });
    await driver.resumeSubscription('sub_test'); expect(sent).toEqual({ cancel_at_period_end: false });
  });

  it('l’empreinte de visite demande une capture manuelle', async () => {
    const driver = stripeDriver(); let sent: unknown;
    Reflect.set(driver, 'stripe', { paymentIntents: { create: async (data: unknown) => {
      sent = data; return { id: 'pi_test', status: 'requires_payment_method', amount: 1000, client_secret: null };
    } } });
    await driver.createPaymentIntent({ amountCents: 1000, currency: 'EUR', description: 'Empreinte', captureMethod: 'manual' });
    expect(sent).toMatchObject({ capture_method: 'manual' });
  });

  it('un abonnement sans bien enregistre une carte puis crée une quantité zéro avec clé stable', async () => {
    const driver = stripeDriver(); const calls: unknown[] = [];
    Reflect.set(driver, 'stripe', { setupIntents: { retrieve: async () => ({ status: 'succeeded', payment_method: 'pm_test' }) },
      subscriptions: { create: async (...args: unknown[]) => {
        calls.push(args); return { id: 'sub_test', customer: 'cus_test', status: 'active', metadata: { localSubscriptionId: 'local' }, items: { data: [{ current_period_end: 2000000000, quantity: 0 }] } };
      } },
    });
    const session: DriverCheckout = { id: 'cs_test', url: null, status: 'complete', mode: 'setup', checkoutId: 'key', amountCents: null, currency: null,
      paid: true, paymentIntentId: null, subscriptionId: null, customerId: 'cus_test', setupIntentId: 'seti_test',
    };
    await driver.subscriptionFromCheckout(session, { mode: 'setup', userId: 'u', resourceId: 'local', email: 'test@bail.test', amountCents: 3900, quantity: 0,
      label: 'Abonnement', successUrl: 'http://localhost:3000', cancelUrl: 'http://localhost:3000', expiresAt: 2000000000,
    }, 'key');
    expect(calls[0]).toEqual([expect.objectContaining({ default_payment_method: 'pm_test', metadata: { localSubscriptionId: 'local' },
      items: [expect.objectContaining({ quantity: 0, price_data: expect.objectContaining({ unit_amount: 3900 }) })],
    }), { idempotencyKey: 'subscription:key' }]);
  });
});
