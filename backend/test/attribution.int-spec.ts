import request from 'supertest';
import {
  ApplicationStatus,
  PreauthorizationStatus,
  PropertyStatus,
  UserRole,
  VisitStatus,
  VisitType,
} from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import {
  TEST_PASSWORD,
  createLeaseTemplate,
  createProperty,
  createUser,
  createVerifiedFile,
} from './fixtures';
import {
  ATTRIBUTION_REASON,
  ATTRIBUTION_VISIT_REASON,
} from '../src/modules/applications/attribution';
import { EVENT } from '../src/modules/mail/event.templates';
import { EventResolver } from '../src/modules/mail/event.resolver';

/**
 * Attribution d'un logement.
 *
 * Un seul geste du propriétaire en referme plusieurs autres : le bail s'ouvre,
 * le bien sort de la diffusion, et **toutes les candidatures encore en cours se
 * ferment d'un coup**. Ce sont ces effets collatéraux que la suite tient, parce
 * qu'ils touchent des gens qui n'ont rien décidé et à qui on doit une réponse
 * exacte : ni un refus qu'on ne leur a pas opposé, ni un rendez-vous maintenu
 * sur un logement qui n'est plus à prendre.
 */
describe('Attribution d’un logement', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());

  const loginAs = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return sessionCookie(response);
  };

  /** Candidature posée directement : le parcours d'envoi est testé ailleurs. */
  const apply = async (propertyId: string, tenantId: string, status: ApplicationStatus) => {
    const file = await createVerifiedFile(h.prisma, tenantId);
    return h.prisma.application.create({
      data: { propertyId, tenantId, tenantFileId: file.id, status },
    });
  };

  const queuedFor = async (applicationId: string) =>
    (
      await h.prisma.emailMessage.findMany({
        where: { subjectRef: applicationId },
        select: { template: true },
      })
    ).map((message) => message.template);

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
    // Accepter un candidat ouvre son bail : sans modèle en base, la requête
    // échoue en 400 avant d'atteindre ce que ces cas vérifient.
    await createLeaseTemplate(h.prisma);
  });

  it('ferme les autres candidatures et les prévient par leur propre gabarit', async () => {
    // Le gabarit du refus annoncerait une décision que personne n'a formulée :
    // ces dossiers n'ont pas été examinés puis écartés, le logement est parti.
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);

    const [retenu, ecarte, autre] = await Promise.all([
      createUser(h.prisma, UserRole.TENANT),
      createUser(h.prisma, UserRole.TENANT),
      createUser(h.prisma, UserRole.TENANT),
    ]);
    const gagnante = await apply(property.id, retenu.id, ApplicationStatus.SHORTLISTED);
    const fermees = [
      await apply(property.id, ecarte.id, ApplicationStatus.READ),
      await apply(property.id, autre.id, ApplicationStatus.SUBMITTED),
    ];

    await api()
      .post(`/api/v1/owner/applications/${gagnante.id}/accept`)
      .set('Cookie', await loginAs(owner.email))
      .expect(200);

    for (const fermee of fermees) {
      const apres = await h.prisma.application.findUniqueOrThrow({
        where: { id: fermee.id },
      });
      expect(apres.status).toBe(ApplicationStatus.REJECTED);
      expect(apres.rejectionReason).toBe(ATTRIBUTION_REASON);
      expect(apres.decidedAt).not.toBeNull();
      expect(await queuedFor(fermee.id)).toEqual([EVENT.applicationClosedByAttribution]);
    }

    // Le candidat retenu garde le sien, et le bien sort de la diffusion.
    expect(await queuedFor(gagnante.id)).toEqual([EVENT.applicationAccepted]);
    const bien = await h.prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(bien.status).toBe(PropertyStatus.RENTED);
  });

  it('annule le rendez-vous d’un candidat fermé et rend son créneau', async () => {
    // Sans cette annulation, quelqu'un se déplacerait pour visiter un logement
    // déjà loué — et le propriétaire l'y attendrait.
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    const [retenu, visiteur] = await Promise.all([
      createUser(h.prisma, UserRole.TENANT),
      createUser(h.prisma, UserRole.TENANT),
    ]);

    const gagnante = await apply(property.id, retenu.id, ApplicationStatus.SHORTLISTED);
    const perdante = await apply(
      property.id,
      visiteur.id,
      ApplicationStatus.VISIT_SCHEDULED,
    );

    const visit = await h.prisma.visit.create({
      data: {
        propertyId: property.id,
        tenantId: visiteur.id,
        applicationId: perdante.id,
        type: VisitType.ACCOMPANIED,
        status: VisitStatus.CONFIRMED,
        scheduledAt: new Date('2026-10-01T10:00:00Z'),
        preauthorizationStatus: PreauthorizationStatus.AUTHORIZED,
      },
    });
    const slot = await h.prisma.visitSlot.create({
      data: {
        propertyId: property.id,
        openedById: owner.id,
        startsAt: new Date('2026-10-01T10:00:00Z'),
        visitId: visit.id,
      },
    });

    await api()
      .post(`/api/v1/owner/applications/${gagnante.id}/accept`)
      .set('Cookie', await loginAs(owner.email))
      .expect(200);

    const apres = await h.prisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
    expect(apres.status).toBe(VisitStatus.CANCELLED);
    expect(apres.cancellationReason).toBe(ATTRIBUTION_VISIT_REASON);
    expect(apres.cancelledAt).not.toBeNull();
    // L'empreinte bancaire est rendue : rien n'a été consommé.
    expect(apres.preauthorizationStatus).toBe(PreauthorizationStatus.RELEASED);

    const creneau = await h.prisma.visitSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(creneau.visitId).toBeNull();
  });

  it('dit au locataire « Logement attribué », pas « Non retenue »', async () => {
    // Cohérent avec l'e-mail : le même événement ne peut pas se raconter d'une
    // façon dans la boîte de réception et d'une autre à l'écran.
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    const [retenu, ecarte] = await Promise.all([
      createUser(h.prisma, UserRole.TENANT),
      createUser(h.prisma, UserRole.TENANT),
    ]);
    const gagnante = await apply(property.id, retenu.id, ApplicationStatus.SHORTLISTED);
    await apply(property.id, ecarte.id, ApplicationStatus.READ);

    await api()
      .post(`/api/v1/owner/applications/${gagnante.id}/accept`)
      .set('Cookie', await loginAs(owner.email))
      .expect(200);

    const vue = await api()
      .get('/api/v1/tenant/applications')
      .set('Cookie', await loginAs(ecarte.email))
      .expect(200);

    expect(vue.body[0].stepLabel).toBe('Logement attribué');
  });

  it('garde son gabarit au refus explicite du propriétaire', async () => {
    // Le nouveau gabarit ne doit pas avaler le cas où le propriétaire a bel et
    // bien tranché : là, une décision a été prise, et elle s'annonce.
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);
    const tenant = await createUser(h.prisma, UserRole.TENANT);
    const candidature = await apply(property.id, tenant.id, ApplicationStatus.READ);

    await api()
      .post(`/api/v1/owner/applications/${candidature.id}/reject`)
      .set('Cookie', await loginAs(owner.email))
      .send({ reason: 'Taux d’effort trop élevé' })
      .expect(200);

    expect(await queuedFor(candidature.id)).toEqual([EVENT.applicationRejected]);
  });

  describe('reconstruction au moment de l’envoi', () => {
    it('abandonne le message si la candidature ne porte plus ce motif', async () => {
      // La file ne stocke qu'une référence : le contenu est relu à l'envoi. Une
      // candidature rouverte entre-temps annoncerait une situation périmée.
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const candidature = await apply(property.id, tenant.id, ApplicationStatus.READ);

      await h.prisma.application.update({
        where: { id: candidature.id },
        data: {
          status: ApplicationStatus.REJECTED,
          rejectionReason: ATTRIBUTION_REASON,
        },
      });

      const resolver = h.app.get(EventResolver);
      const avant = await resolver.resolve(
        EVENT.applicationClosedByAttribution,
        candidature.id,
        tenant.id,
      );
      expect(avant?.message.subject).toContain('Logement attribué');
      // Sans rendez-vous pris, le message ne parle pas d'annulation.
      expect(avant?.message.text).not.toContain('rendez-vous');

      await h.prisma.application.update({
        where: { id: candidature.id },
        data: { status: ApplicationStatus.SHORTLISTED, rejectionReason: null },
      });

      await expect(
        resolver.resolve(EVENT.applicationClosedByAttribution, candidature.id, tenant.id),
      ).resolves.toBeNull();
    });

    it('mentionne le rendez-vous annulé quand il y en avait un', async () => {
      const owner = await createUser(h.prisma, UserRole.OWNER);
      const property = await createProperty(h.prisma, owner.id);
      const tenant = await createUser(h.prisma, UserRole.TENANT);
      const candidature = await apply(
        property.id,
        tenant.id,
        ApplicationStatus.VISIT_SCHEDULED,
      );

      await h.prisma.application.update({
        where: { id: candidature.id },
        data: {
          status: ApplicationStatus.REJECTED,
          rejectionReason: ATTRIBUTION_REASON,
        },
      });
      await h.prisma.visit.create({
        data: {
          propertyId: property.id,
          tenantId: tenant.id,
          applicationId: candidature.id,
          type: VisitType.VIDEO,
          status: VisitStatus.CANCELLED,
          scheduledAt: new Date('2026-10-01T10:00:00Z'),
          cancelledAt: new Date(),
          cancellationReason: ATTRIBUTION_VISIT_REASON,
        },
      });

      const resolver = h.app.get(EventResolver);
      const message = await resolver.resolve(
        EVENT.applicationClosedByAttribution,
        candidature.id,
        tenant.id,
      );

      expect(message?.message.text).toContain('rendez-vous de visite');
      // Le mot « refus » ne doit apparaître nulle part : rien n'a été refusé.
      expect(message?.message.text.toLowerCase()).not.toContain('refus');
    });
  });
});
