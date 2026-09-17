ALTER TABLE "leases" ADD COLUMN "signatureRequestId" TEXT,
  ADD COLUMN "signatureRequestedAt" TIMESTAMP(3), ADD COLUMN "signatureRequest" JSONB;
CREATE UNIQUE INDEX "leases_signatureRequestId_key" ON "leases"("signatureRequestId");
