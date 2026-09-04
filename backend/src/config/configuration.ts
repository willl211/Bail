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

  /**
   * Adresse publique du front.
   *
   * Sert à fabriquer les liens des e-mails (confirmation d'adresse,
   * réinitialisation). L'API ne peut pas la déduire de la requête : un lien
   * construit à partir d'un en-tête `Host` se laisse détourner vers le domaine
   * d'un attaquant, et le lien porte justement un secret.
   */
  siteUrl: (process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),

  /**
   * E-mails transactionnels.
   *
   * `mock` écrit les messages sur disque au lieu de les envoyer ; `smtp` parle
   * à un vrai serveur — Mailpit en local, le prestataire ailleurs. Aucun
   * prestataire n'est retenu, mais SMTP étant un protocole et non une API
   * propriétaire, le driver est vérifiable de bout en bout sans compte.
   */
  mail: {
    driver: process.env.MAIL_DRIVER ?? 'mock',
    /** Expéditeur affiché. Une adresse sans boîte de réception. */
    from: process.env.MAIL_FROM ?? 'Bail <ne-pas-repondre@bail.local>',
    /** Adresse de réponse, quand elle diffère de l'expéditeur. */
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    smtp: {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
      /** TLS implicite (port 465). Ailleurs, STARTTLS est négocié. */
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || undefined,
      password: process.env.SMTP_PASSWORD || undefined,
    },
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
      region: process.env.S3_REGION ?? 'gra',
      /**
       * Deux conteneurs, pas un seul avec deux préfixes : un préfixe se
       * contourne par une règle d'accès trop large, deux conteneurs se
       * configurent séparément — et celui des pièces de dossier reste fermé
       * sans exception à prévoir.
       */
      publicBucket: process.env.S3_BUCKET_PUBLIC,
      privateBucket: process.env.S3_BUCKET_PRIVATE,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      /**
       * Style de chemin plutôt que de sous-domaine. Requis par MinIO et par la
       * plupart des stockages compatibles S3 sans DNS générique par conteneur.
       */
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
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
