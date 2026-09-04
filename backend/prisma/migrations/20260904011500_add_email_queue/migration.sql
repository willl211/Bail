-- DropIndex
DROP INDEX "email_messages_status_idx";

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "subjectRef" TEXT,
ALTER COLUMN "subject" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_dedupeKey_key" ON "email_messages"("dedupeKey");

-- CreateIndex
CREATE INDEX "email_messages_status_nextAttemptAt_idx" ON "email_messages"("status", "nextAttemptAt");
