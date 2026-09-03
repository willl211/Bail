-- CreateTable
CREATE TABLE "visit_slots" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "allowedTypes" "VisitType"[] DEFAULT ARRAY['ACCOMPANIED', 'VIDEO']::"VisitType"[],
    "visitId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_slots_visitId_key" ON "visit_slots"("visitId");

-- CreateIndex
CREATE INDEX "visit_slots_propertyId_startsAt_closedAt_idx" ON "visit_slots"("propertyId", "startsAt", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "visit_slots_propertyId_startsAt_key" ON "visit_slots"("propertyId", "startsAt");

-- AddForeignKey
ALTER TABLE "visit_slots" ADD CONSTRAINT "visit_slots_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_slots" ADD CONSTRAINT "visit_slots_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_slots" ADD CONSTRAINT "visit_slots_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
