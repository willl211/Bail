CREATE TYPE "PayslipAnalysisStatus" AS ENUM ('UNAVAILABLE', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TABLE "payslip_analyses" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "status" "PayslipAnalysisStatus" NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "promptVersion" TEXT NOT NULL,
  "sourceStorageKey" TEXT NOT NULL,
  "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
  "sourceSha256" TEXT,
  "result" JSONB,
  "errorCode" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "runToken" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestedById" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payslip_analyses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payslip_analyses_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "tenant_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payslip_analyses_documentId_key" ON "payslip_analyses"("documentId");
CREATE INDEX "payslip_analyses_status_nextAttemptAt_idx" ON "payslip_analyses"("status", "nextAttemptAt");
