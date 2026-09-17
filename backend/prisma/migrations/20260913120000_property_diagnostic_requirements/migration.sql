CREATE TYPE "DiagnosticRequirement" AS ENUM ('UNKNOWN', 'REQUIRED', 'NOT_REQUIRED');
ALTER TABLE "properties"
  ADD COLUMN "electricalDiagnostic" "DiagnosticRequirement" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "gasDiagnostic" "DiagnosticRequirement" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "riskDiagnostic" "DiagnosticRequirement" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "noiseDiagnostic" "DiagnosticRequirement" NOT NULL DEFAULT 'UNKNOWN';
ALTER TYPE "PropertyDocumentType" ADD VALUE 'NOISE';
ALTER TABLE "property_documents" ADD COLUMN "leadNoRisk" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "properties" ADD COLUMN "publicationBillingSyncPending" BOOLEAN NOT NULL DEFAULT false;
