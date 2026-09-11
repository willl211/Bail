ALTER TABLE "properties" ADD COLUMN "reviewRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "property_documents" ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE TABLE "property_review_events" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "actorLabel" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_review_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "property_review_events_propertyId_revision_key" ON "property_review_events"("propertyId", "revision");
CREATE INDEX "property_review_events_createdAt_idx" ON "property_review_events"("createdAt");
ALTER TABLE "property_review_events" ADD CONSTRAINT "property_review_events_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
