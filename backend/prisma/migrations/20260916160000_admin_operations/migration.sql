ALTER TABLE "sessions" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
CREATE TABLE "mfa_credentials" (
 "userId" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "secretEncrypted" TEXT NOT NULL, "enabledAt" TIMESTAMP(3), "setupExpiresAt" TIMESTAMP(3) NOT NULL,
 "lastUsedStep" BIGINT NOT NULL DEFAULT -1, "recoveryHashes" TEXT[] NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "security_events" (
 "id" TEXT PRIMARY KEY, "actorId" TEXT, "subjectId" TEXT, "action" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "security_events_createdAt_idx" ON "security_events"("createdAt");
CREATE TABLE "erasure_requests" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "reviewNote" TEXT, "reviewedById" TEXT, "fileKeys" TEXT[] NOT NULL,
 "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "erasure_requests_status_createdAt_idx" ON "erasure_requests"("status", "createdAt");
CREATE TABLE "operational_incidents" (
 "fingerprint" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL, "category" TEXT NOT NULL, "route" TEXT NOT NULL,
 "count" INTEGER NOT NULL DEFAULT 1, "acknowledgedAt" TIMESTAMP(3),
 "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "operational_incidents_lastSeenAt_idx" ON "operational_incidents"("lastSeenAt");
