import { UserRole } from '@prisma/client';
import { createHarness, resetDatabase, type Harness } from './harness';
import { createProperty, createUser } from './fixtures';
import { MailWorker } from '../src/modules/mail/mail.worker';
import { EVENT } from '../src/modules/mail/event.templates';

/**
 * File d'envoi : prise en charge des messages.
 *
 * Le pilote tourne sur une seule instance d'API, mais la file est le seul
 * endroit où passer à deux instances enverrait deux fois le même message — et
 * un e-mail parti deux fois ne se rattrape pas. La prise en charge est donc
 * atomique, et c'est cette propriété-là que la suite tient : deux appels
 * simultanés ne doivent jamais rendre le même message.
 *
 * Le garde en mémoire du worker ne prouverait rien ici : il ne protège que d'un
 * chevauchement dans le même processus, pas de la machine d'à côté.
 */
describe('File d’envoi', () => {
  let h: Harness;
  const worker = () => h.app.get(MailWorker);

  /** Messages en attente, prêts à partir. */
  const enqueue = async (count: number) => {
    const owner = await createUser(h.prisma, UserRole.OWNER);
    const property = await createProperty(h.prisma, owner.id);

    await h.prisma.emailMessage.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        template: EVENT.propertyPublished,
        recipientEmail: owner.email,
        recipientId: owner.id,
        subjectRef: property.id,
        dedupeKey: `test:${property.id}:${index}`,
        driver: 'mock',
        nextAttemptAt: new Date(),
      })),
    });
    return { owner, property };
  };

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
  });

  it('ne rend jamais deux fois le même message à deux appels simultanés', async () => {
    // Le cas qu'on veut rendre impossible : deux instances d'API qui vident la
    // file en même temps et envoient chacune le même e-mail.
    await enqueue(12);

    const [premier, second] = await Promise.all([worker().claim(), worker().claim()]);
    const ids = [...premier, ...second].map((message) => message.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(12);
  });

  it('rend un message invisible le temps de son envoi', async () => {
    // C'est ce qui remplace un verrou : le message réservé est repoussé dans le
    // temps, donc invisible à qui regarde la file juste après.
    await enqueue(1);

    const premier = await worker().claim();
    expect(premier).toHaveLength(1);

    expect(await worker().claim()).toEqual([]);

    const message = await h.prisma.emailMessage.findUniqueOrThrow({
      where: { id: premier[0].id },
    });
    expect(message.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('rend le message de lui-même si l’instance tombe en plein envoi', async () => {
    // Aucun état « en cours » n'est écrit : rien à nettoyer après un incident,
    // le message redevient simplement disponible au bout du délai.
    const { property } = await enqueue(1);
    await worker().claim();

    await h.prisma.emailMessage.updateMany({
      where: { subjectRef: property.id },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });

    expect(await worker().claim()).toHaveLength(1);
  });

  it('retarde les nouveaux, pas les anciens, quand la file déborde', async () => {
    // Un message qui attend depuis une heure a déjà coûté à quelqu'un : c'est
    // le dernier arrivé qui doit patienter. On remplit un lot entier plus un,
    // et on regarde lequel reste — l'ordre du tableau rendu, lui, ne prouve
    // rien : `RETURNING` ne garantit aucun ordre.
    const { owner, property } = await enqueue(20);
    const dernier = await h.prisma.emailMessage.create({
      data: {
        template: EVENT.propertyPublished,
        recipientEmail: owner.email,
        recipientId: owner.id,
        subjectRef: property.id,
        dedupeKey: 'le-plus-recent',
        driver: 'mock',
        nextAttemptAt: new Date(),
        createdAt: new Date(Date.now() + 3_600_000),
      },
    });

    const pris = await worker().claim();

    expect(pris).toHaveLength(20);
    expect(pris.map((message) => message.id)).not.toContain(dernier.id);
  });

  it('laisse de côté un message sans objet à reconstruire', async () => {
    // La file ne stocke que la référence : sans elle, il n'y a rien à écrire.
    const owner = await createUser(h.prisma, UserRole.OWNER);
    await h.prisma.emailMessage.create({
      data: {
        template: EVENT.propertyPublished,
        recipientEmail: owner.email,
        recipientId: owner.id,
        subjectRef: null,
        dedupeKey: 'sans-objet',
        driver: 'mock',
        nextAttemptAt: new Date(),
      },
    });

    expect(await worker().claim()).toEqual([]);
  });
});
