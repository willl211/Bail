ALTER TYPE "SubscriptionStatus" ADD VALUE 'INCOMPLETE';
CREATE TABLE "payment_checkouts" (
  "id" TEXT NOT NULL,
  "activeScope" TEXT,
  "payerId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "kind" "PaymentType" NOT NULL,
  "input" JSONB NOT NULL,
  "providerSessionId" TEXT,
  "completedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_checkouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_checkouts_activeScope_key" ON "payment_checkouts"("activeScope");
CREATE UNIQUE INDEX "payment_checkouts_providerSessionId_key" ON "payment_checkouts"("providerSessionId");
CREATE INDEX "payment_checkouts_payerId_kind_idx" ON "payment_checkouts"("payerId", "kind");
