import request from 'supertest';
import { AuthTokenPurpose } from '@prisma/client';
import { createHarness, resetDatabase, sessionCookie, type Harness } from './harness';
import { hashSecret, newSecret } from '../src/modules/auth/tokens';

/**
 * Parcours de compte, de bout en bout.
 *
 * Ce que ces cas protègent tient en une phrase : un lien reçu par e-mail vaut
 * un mot de passe. Ils vérifient donc qu'il ne sert qu'une fois, qu'il expire,
 * qu'il n'est jamais stocké en clair, et que le formulaire public qui le
 * déclenche ne révèle pas qui possède un compte.
 */
describe('Comptes et jetons', () => {
  let h: Harness;
  const api = () => request(h.app.getHttpServer());

  const signup = (email: string, password = 'MotDePasseDeTest2026') =>
    api()
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Awa', lastName: 'Diallo', role: 'TENANT' });

  /** Le secret ne survit qu'en mémoire : on le fabrique pour pouvoir le rejouer. */
  async function issueToken(
    userId: string,
    purpose: AuthTokenPurpose,
    expiresAt = new Date(Date.now() + 3_600_000),
  ): Promise<string> {
    const secret = newSecret();
    await h.prisma.authToken.create({
      data: { tokenHash: hashSecret(secret), purpose, userId, expiresAt },
    });
    return secret;
  }

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDatabase(h.prisma);
  });

  describe('inscription', () => {
    it('crée un compte non confirmé et ouvre une session', async () => {
      const response = await signup('awa@bail.test').expect(201);

      expect(response.body.user.emailVerified).toBe(false);
      expect(sessionCookie(response)).toMatch(/^bail_session=/);
      // Le hachage du mot de passe ne sort jamais de la base.
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('émet un jeton de confirmation dont seule l’empreinte est stockée', async () => {
      await signup('awa@bail.test').expect(201);

      const tokens = await h.prisma.authToken.findMany();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].purpose).toBe(AuthTokenPurpose.EMAIL_VERIFICATION);
      // 64 caractères hexadécimaux : une empreinte SHA-256, pas un secret.
      expect(tokens[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('consigne l’envoi sans en garder le contenu', async () => {
      await signup('awa@bail.test').expect(201);

      const [message] = await h.prisma.emailMessage.findMany();
      expect(message.template).toBe('email-verification');
      expect(message.recipientEmail).toBe('awa@bail.test');
      // Aucune colonne ne porte de corps de message : la table ne doit pas
      // devenir un double des données du produit, ni un dépôt de liens actifs.
      expect(Object.keys(message)).not.toContain('body');
      expect(JSON.stringify(message)).not.toContain('http://');
    });

    it('refuse un rôle interne à l’inscription publique', async () => {
      // Laisser choisir son rôle donnerait un accès back-office à qui le demande.
      await api()
        .post('/api/v1/auth/register')
        .send({
          email: 'faux.agent@bail.test',
          password: 'MotDePasseDeTest2026',
          firstName: 'X',
          lastName: 'Y',
          role: 'AGENT',
        })
        .expect(400);
    });

    it('refuse un mot de passe trop court', async () => {
      await signup('awa@bail.test', 'court').expect(400);
    });
  });

  describe('confirmation d’adresse', () => {
    it('confirme, puis refuse le même lien une seconde fois', async () => {
      const response = await signup('awa@bail.test').expect(201);
      const token = await issueToken(
        response.body.user.id,
        AuthTokenPurpose.EMAIL_VERIFICATION,
      );

      await api()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ token })
        .expect(200);

      await api()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ token })
        .expect(400);
    });

    it('refuse un lien expiré', async () => {
      const response = await signup('awa@bail.test').expect(201);
      const token = await issueToken(
        response.body.user.id,
        AuthTokenPurpose.EMAIL_VERIFICATION,
        new Date(Date.now() - 1000),
      );

      await api()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ token })
        .expect(400);
    });

    it('donne le même message pour un jeton inconnu que pour un jeton usé', async () => {
      const inconnu = await api()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ token: 'jeton-qui-n-existe-pas' })
        .expect(400);

      const response = await signup('awa@bail.test').expect(201);
      const token = await issueToken(
        response.body.user.id,
        AuthTokenPurpose.EMAIL_VERIFICATION,
        new Date(Date.now() - 1000),
      );
      const expire = await api()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ token })
        .expect(400);

      expect(inconnu.body.message).toBe(expire.body.message);
    });

    it('refuse un jeton de réinitialisation présenté comme confirmation', async () => {
      // Les usages ne sont pas interchangeables : un lien « mot de passe
      // oublié » ne doit pas pouvoir confirmer une adresse.
      const response = await signup('awa@bail.test').expect(201);
      const token = await issueToken(
        response.body.user.id,
        AuthTokenPurpose.PASSWORD_RESET,
      );

      await api()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ token })
        .expect(400);
    });
  });

  describe('mot de passe oublié', () => {
    it('répond 204 pour une adresse inconnue, sans rien envoyer', async () => {
      // Une réponse différente ferait de ce formulaire public un annuaire des
      // clients de la plateforme.
      await api()
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'personne@bail.test' })
        .expect(204);

      expect(await h.prisma.emailMessage.count()).toBe(0);
    });

    it('répond 204 pour une adresse connue, et envoie', async () => {
      await signup('awa@bail.test').expect(201);

      await api()
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'awa@bail.test' })
        .expect(204);

      expect(
        await h.prisma.emailMessage.count({ where: { template: 'password-reset' } }),
      ).toBe(1);
    });

    it('plafonne les envois à trois par heure, en silence', async () => {
      await signup('awa@bail.test').expect(201);

      for (let i = 0; i < 6; i += 1) {
        await api()
          .post('/api/v1/auth/password/forgot')
          .send({ email: 'awa@bail.test' })
          .expect(204);
      }

      // Sans plafond, ce formulaire public inonderait la boîte de n'importe
      // qui. Le dépassement reste muet, pour ne pas confirmer l'existence du
      // compte à celui qui l'a provoqué.
      expect(
        await h.prisma.emailMessage.count({ where: { template: 'password-reset' } }),
      ).toBe(3);
    });

    it('invalide le jeton précédent en en émettant un nouveau', async () => {
      const response = await signup('awa@bail.test').expect(201);
      const premier = await issueToken(
        response.body.user.id,
        AuthTokenPurpose.PASSWORD_RESET,
      );

      await api()
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'awa@bail.test' })
        .expect(204);

      // Un lien intercepté ne doit pas rester exploitable alors que son
      // destinataire croit l'avoir remplacé.
      await api()
        .post('/api/v1/auth/password/reset')
        .send({ token: premier, password: 'UnAutreMotDePasse2026' })
        .expect(400);
    });
  });

  describe('réinitialisation', () => {
    it('change le mot de passe et ferme toutes les sessions', async () => {
      const inscription = await signup('awa@bail.test').expect(201);
      const cookie = sessionCookie(inscription);
      const token = await issueToken(
        inscription.body.user.id,
        AuthTokenPurpose.PASSWORD_RESET,
      );

      await api()
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'UnAutreMotDePasse2026' })
        .expect(204);

      // Fermer les sessions est ce qui donne son sens au choix de la session
      // plutôt que du JWT : si le compte était détourné, l'intrus perd l'accès.
      const apres = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      expect(apres.body.user).toBeNull();

      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'awa@bail.test', password: 'MotDePasseDeTest2026' })
        .expect(401);

      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'awa@bail.test', password: 'UnAutreMotDePasse2026' })
        .expect(200);
    });

    it('prévient le titulaire du changement', async () => {
      const inscription = await signup('awa@bail.test').expect(201);
      const token = await issueToken(
        inscription.body.user.id,
        AuthTokenPurpose.PASSWORD_RESET,
      );

      await api()
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'UnAutreMotDePasse2026' })
        .expect(204);

      // Seul moyen pour lui de s'apercevoir d'un changement qu'il n'a pas demandé.
      expect(
        await h.prisma.emailMessage.count({ where: { template: 'password-changed' } }),
      ).toBe(1);
    });

    it('refuse un mot de passe trop court malgré un jeton valable', async () => {
      const inscription = await signup('awa@bail.test').expect(201);
      const token = await issueToken(
        inscription.body.user.id,
        AuthTokenPurpose.PASSWORD_RESET,
      );

      await api()
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'court' })
        .expect(400);

      // Le jeton n'a pas été consommé par une saisie invalide : l'utilisateur
      // doit pouvoir réessayer sans redemander un lien.
      const [stored] = await h.prisma.authToken.findMany({
        where: { purpose: AuthTokenPurpose.PASSWORD_RESET },
      });
      expect(stored.consumedAt).toBeNull();
    });
  });

  describe('changement volontaire', () => {
    it('exige le mot de passe actuel', async () => {
      const inscription = await signup('awa@bail.test').expect(201);

      await api()
        .post('/api/v1/auth/password/change')
        .set('Cookie', sessionCookie(inscription))
        .send({ currentPassword: 'faux', password: 'UnAutreMotDePasse2026' })
        .expect(401);
    });

    it('refuse de réutiliser le mot de passe actuel', async () => {
      const inscription = await signup('awa@bail.test').expect(201);

      await api()
        .post('/api/v1/auth/password/change')
        .set('Cookie', sessionCookie(inscription))
        .send({
          currentPassword: 'MotDePasseDeTest2026',
          password: 'MotDePasseDeTest2026',
        })
        .expect(400);
    });

    it('exige une session', async () => {
      await api()
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: 'x', password: 'UnAutreMotDePasse2026' })
        .expect(401);
    });
  });

  describe('connexion', () => {
    it('donne le même message pour un compte inconnu et un mot de passe faux', async () => {
      await signup('awa@bail.test').expect(201);

      const inconnu = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'personne@bail.test', password: 'MotDePasseDeTest2026' })
        .expect(401);
      const faux = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'awa@bail.test', password: 'MauvaisMotDePasse2026' })
        .expect(401);

      expect(inconnu.body.message).toBe(faux.body.message);
    });

    it('déconnecte sans erreur même sans session', async () => {
      // Se déconnecter avec un cookie déjà mort ne doit pas coincer
      // l'utilisateur sur une erreur.
      await api().post('/api/v1/auth/logout').expect(204);
    });
  });
});
