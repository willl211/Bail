ALTER TABLE "tenant_files" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "verifiedRevision" INTEGER;

CREATE TABLE "tenant_file_events" (
    "id" TEXT NOT NULL,
    "tenantFileId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_file_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_file_events_tenantFileId_revision_key" ON "tenant_file_events"("tenantFileId", "revision");
CREATE INDEX "tenant_file_events_createdAt_idx" ON "tenant_file_events"("createdAt");
ALTER TABLE "tenant_file_events" ADD CONSTRAINT "tenant_file_events_tenantFileId_fkey"
FOREIGN KEY ("tenantFileId") REFERENCES "tenant_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- L'ancien sceau ne permet pas de connaître les données réellement contrôlées.
-- Conserver les dossiers et leurs pièces, demander une nouvelle validation,
-- sans inventer un auteur ni une validation rétroactive.
INSERT INTO "tenant_file_events" ("id", "tenantFileId", "revision", "action", "actorLabel", "title", "note")
SELECT 'verification-migration-' || "id", "id", 1, 'REVIEW_REQUIRED', 'whoma — mise à jour',
       'Nouvelle validation nécessaire',
       'Le dossier et ses pièces sont conservés. La validation précédente ne précisait pas la version des informations contrôlées.'
FROM "tenant_files" WHERE "status" = 'VERIFIED';
UPDATE "tenant_files" SET "status" = 'SUBMITTED', "verifiedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'VERIFIED';
