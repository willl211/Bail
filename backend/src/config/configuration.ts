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

  auth: {
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './storage',
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
