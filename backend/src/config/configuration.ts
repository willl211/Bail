/**
 * Configuration applicative.
 *
 * Les intégrations réglementées (KYC, signature, paiement) exposent un `driver`
 * pour rester en sandbox/mock pendant tout le développement — voir
 * docs/integrations.md. Aucune valeur métier (barème d'honoraires, montant
 * d'abonnement) ne vit ici : elle est en base, modifiable sans redéploiement
 * (docs/legal-context.md).
 */
export type AppEnvironment = 'development' | 'staging' | 'production';

export default () => ({
  appEnv: (process.env.APP_ENV ?? 'development') as AppEnvironment,
  port: parseInt(process.env.PORT ?? '4000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  database: {
    url: process.env.DATABASE_URL,
  },

  /**
   * Authentification par session serveur + cookie `httpOnly`
   * (docs/tech-stack.md). Pas de JWT : une session doit pouvoir être révoquée
   * immédiatement, les comptes donnant accès à des pièces d'identité et à des
   * bulletins de salaire.
   */
  auth: {
    /** Nom du cookie de session. */
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'bail_session',
    /** Durée de vie d'une session, en jours. */
    sessionTtlDays: parseInt(process.env.SESSION_TTL_DAYS ?? '30', 10),
    /**
     * `secure` est désactivable uniquement en développement, où le front est
     * servi en clair sur localhost. Partout ailleurs le cookie est réservé au
     * HTTPS.
     */
    cookieSecure: (process.env.SESSION_COOKIE_SECURE ?? 'true') !== 'false',
    /** Domaine du cookie ; vide en local. */
    cookieDomain: process.env.SESSION_COOKIE_DOMAIN || undefined,
    /** Coût du hachage bcrypt des mots de passe. */
    passwordSaltRounds: parseInt(process.env.PASSWORD_SALT_ROUNDS ?? '12', 10),
  },

  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './storage',
    /**
     * Base des URL de fichiers publics (photos d'annonces).
     *
     * Absolue, parce que le front est servi sur une autre origine que l'API :
     * une URL relative se résoudrait contre le domaine du front et donnerait un
     * 404. En production, c'est l'adresse du stockage objet ou du CDN, pas
     * celle de l'API.
     */
    publicBaseUrl:
      process.env.PUBLIC_ASSET_BASE_URL ?? 'http://localhost:4000/uploads',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  },

  integrations: {
    // Prestataire non choisi : `mock` obligatoire pour l'instant.
    kyc: {
      driver: process.env.KYC_DRIVER ?? 'mock',
      mockDefaultResult: process.env.KYC_MOCK_DEFAULT_RESULT ?? 'verified',
    },
    signature: {
      driver: process.env.SIGNATURE_DRIVER ?? 'mock',
      docusign: {
        baseUrl: process.env.DOCUSIGN_BASE_URL,
        integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
        userId: process.env.DOCUSIGN_USER_ID,
        accountId: process.env.DOCUSIGN_ACCOUNT_ID,
        privateKey: process.env.DOCUSIGN_PRIVATE_KEY,
      },
    },
    payment: {
      driver: process.env.PAYMENT_DRIVER ?? 'mock',
      stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        /**
         * Produit Stripe portant l'abonnement propriétaire, créé une fois dans
         * le tableau de bord. Le *prix*, lui, n'est pas dans le catalogue : il
         * est construit à chaque souscription à partir du barème en base, qui
         * doit rester modifiable sans redéploiement.
         */
        productId: process.env.STRIPE_PRODUCT_ID,
      },
    },
    video: {
      driver: process.env.VIDEO_DRIVER ?? 'mock',
      daily: { apiKey: process.env.DAILY_API_KEY },
    },
  },

  visits: {
    /**
     * Enregistrement vidéo des visites conservé 15 jours puis purgé
     * (docs/integrations.md). Configurable, mais 15 est la valeur confirmée.
     */
    recordingRetentionDays: parseInt(process.env.VISIT_RECORDING_RETENTION_DAYS ?? '15', 10),
    /** Caméra obligatoire pendant la visite : confirmé, non désactivable. */
    cameraAlwaysRequired: true,
  },
});
