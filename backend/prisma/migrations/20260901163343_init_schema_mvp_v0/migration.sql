-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'TENANT', 'AGENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ONLINE', 'VISITS_IN_PROGRESS', 'RENTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LeaseType" AS ENUM ('NU', 'MEUBLE');

-- CreateEnum
CREATE TYPE "EnergyRating" AS ENUM ('A', 'B', 'C', 'D', 'E', 'F', 'G');

-- CreateEnum
CREATE TYPE "GuarantorRequirement" AS ENUM ('NONE', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "TenantFileStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'INCOMPLETE', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ID_CARD', 'PASSPORT', 'PAYSLIP', 'EMPLOYMENT_CONTRACT', 'TAX_NOTICE', 'PROOF_OF_ADDRESS', 'STUDENT_CARD', 'GUARANTOR_ID', 'GUARANTOR_INCOME', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('MISSING', 'PENDING', 'PROCESSING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EmploymentContractType" AS ENUM ('CDI', 'CDD', 'PUBLIC_SECTOR', 'SELF_EMPLOYED', 'STUDENT', 'RETIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "GuarantorKind" AS ENUM ('INDIVIDUAL', 'ORGANISATION');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycPurpose" AS ENUM ('TENANT_FILE', 'VISIT', 'LEASE_SIGNATURE');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'READ', 'SHORTLISTED', 'VISIT_SCHEDULED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('ACCOMPANIED', 'VIDEO');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('REQUESTED', 'PENDING_CHECKS', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PreauthorizationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'AUTHORIZED', 'FAILED', 'RELEASED', 'CAPTURED');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('DRAFT', 'FIELDS_VALIDATED', 'SENT_FOR_SIGNATURE', 'PARTIALLY_SIGNED', 'SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('OWNER_SUBSCRIPTION', 'TENANT_FEE', 'OWNER_FEE', 'INVENTORY_FEE', 'DEPOSIT', 'RENT', 'VISIT_PREAUTHORIZATION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FundsStatus" AS ENUM ('NOT_APPLICABLE', 'HELD_BY_PLATFORM', 'PAYOUT_PENDING', 'PAID_OUT_TO_OWNER', 'PAYOUT_FAILED', 'REFUNDED_TO_PAYER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'SEPA_DEBIT', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentalZone" AS ENUM ('ZONE_TRES_TENDUE', 'ZONE_TENDUE', 'ZONE_NON_TENDUE');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Metz',
    "postalCode" TEXT NOT NULL DEFAULT '57000',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "surfaceM2" DOUBLE PRECISION NOT NULL,
    "rooms" INTEGER NOT NULL,
    "bedrooms" INTEGER,
    "floor" TEXT,
    "furnished" BOOLEAN NOT NULL DEFAULT false,
    "leaseType" "LeaseType" NOT NULL,
    "energyRating" "EnergyRating" NOT NULL,
    "gesRating" "EnergyRating",
    "constructionYear" INTEGER,
    "rentCents" INTEGER NOT NULL,
    "chargesCents" INTEGER NOT NULL DEFAULT 0,
    "depositCents" INTEGER NOT NULL,
    "availableFrom" TIMESTAMP(3),
    "availableImmediately" BOOLEAN NOT NULL DEFAULT false,
    "minMonthlyIncomeCents" INTEGER,
    "guarantorRequirement" "GuarantorRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "acceptedContractTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "rentedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Metz',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_photos" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_files" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "TenantFileStatus" NOT NULL DEFAULT 'DRAFT',
    "score" INTEGER,
    "netMonthlyIncomeCents" INTEGER,
    "contractType" "EmploymentContractType",
    "employerName" TEXT,
    "inProbationPeriod" BOOLEAN,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_documents" (
    "id" TEXT NOT NULL,
    "tenantFileId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "storageKey" TEXT,
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guarantors" (
    "id" TEXT NOT NULL,
    "tenantFileId" TEXT NOT NULL,
    "kind" "GuarantorKind" NOT NULL DEFAULT 'INDIVIDUAL',
    "firstName" TEXT,
    "lastName" TEXT,
    "organisationName" TEXT,
    "relationship" TEXT,
    "netMonthlyIncomeCents" INTEGER,
    "contractType" "EmploymentContractType",
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guarantors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_checks" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "purpose" "KycPurpose" NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerReference" TEXT,
    "providerPayload" JSONB,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "tenantFileId" TEXT,

    CONSTRAINT "kyc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantFileId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "compatibilityScore" INTEGER,
    "incomeRatio" DOUBLE PRECISION,
    "message" TEXT,
    "ownerNote" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT,
    "agentId" TEXT,
    "type" "VisitType" NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "videoProvider" TEXT,
    "videoRoomUrl" TEXT,
    "videoRoomId" TEXT,
    "cameraRequired" BOOLEAN NOT NULL DEFAULT true,
    "recordingStorageKey" TEXT,
    "recordingStartedAt" TIMESTAMP(3),
    "recordingExpiresAt" TIMESTAMP(3),
    "recordingPurgedAt" TIMESTAMP(3),
    "kycCheckId" TEXT,
    "preauthorizationStatus" "PreauthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "preauthorizationReference" TEXT,
    "preauthorizationAmountCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" "LeaseType" NOT NULL,
    "body" TEXT NOT NULL,
    "fieldSchema" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "legalReference" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT,
    "templateId" TEXT NOT NULL,
    "templateChecksum" TEXT NOT NULL,
    "type" "LeaseType" NOT NULL,
    "fieldValues" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "rentCents" INTEGER NOT NULL,
    "chargesCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL,
    "validationReport" JSONB,
    "validatedAt" TIMESTAMP(3),
    "documentStorageKey" TEXT,
    "status" "LeaseStatus" NOT NULL DEFAULT 'DRAFT',
    "signatureProvider" TEXT DEFAULT 'docusign',
    "signatureEnvelopeId" TEXT,
    "sentForSignatureAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "signatureEvents" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payerId" TEXT NOT NULL,
    "propertyId" TEXT,
    "applicationId" TEXT,
    "leaseId" TEXT,
    "subscriptionId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "tenantShareCents" INTEGER NOT NULL DEFAULT 0,
    "ownerShareCents" INTEGER NOT NULL DEFAULT 0,
    "feeScheduleId" TEXT,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CARD',
    "fundsStatus" "FundsStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "payoutReference" TEXT,
    "paidOutAt" TIMESTAMP(3),
    "payoutFailureReason" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "providerPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "monthlyAmountCents" INTEGER NOT NULL,
    "feeScheduleId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "zone" "RentalZone" NOT NULL DEFAULT 'ZONE_NON_TENDUE',
    "tenantVisitFeeCentsPerSqm" INTEGER NOT NULL DEFAULT 0,
    "tenantInventoryFeeCentsPerSqm" INTEGER NOT NULL DEFAULT 0,
    "ownerFeeCentsPerSqm" INTEGER NOT NULL DEFAULT 0,
    "ownerSubscriptionMonthlyCents" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isLegallyApproved" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "registryNumber" INTEGER NOT NULL,
    "propertyId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "MandateStatus" NOT NULL DEFAULT 'DRAFT',
    "signedAt" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "documentStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "properties_reference_key" ON "properties"("reference");

-- CreateIndex
CREATE INDEX "properties_status_publishedAt_idx" ON "properties"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "properties_districtId_idx" ON "properties"("districtId");

-- CreateIndex
CREATE INDEX "properties_rentCents_idx" ON "properties"("rentCents");

-- CreateIndex
CREATE INDEX "properties_surfaceM2_idx" ON "properties"("surfaceM2");

-- CreateIndex
CREATE UNIQUE INDEX "districts_slug_key" ON "districts"("slug");

-- CreateIndex
CREATE INDEX "property_photos_propertyId_position_idx" ON "property_photos"("propertyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_files_reference_key" ON "tenant_files"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_files_tenantId_key" ON "tenant_files"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_files_status_idx" ON "tenant_files"("status");

-- CreateIndex
CREATE INDEX "tenant_documents_tenantFileId_type_idx" ON "tenant_documents"("tenantFileId", "type");

-- CreateIndex
CREATE INDEX "guarantors_tenantFileId_idx" ON "guarantors"("tenantFileId");

-- CreateIndex
CREATE INDEX "kyc_checks_subjectId_purpose_status_idx" ON "kyc_checks"("subjectId", "purpose", "status");

-- CreateIndex
CREATE INDEX "applications_tenantId_status_idx" ON "applications"("tenantId", "status");

-- CreateIndex
CREATE INDEX "applications_propertyId_status_idx" ON "applications"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "applications_propertyId_tenantId_key" ON "applications"("propertyId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "visits_kycCheckId_key" ON "visits"("kycCheckId");

-- CreateIndex
CREATE INDEX "visits_propertyId_scheduledAt_idx" ON "visits"("propertyId", "scheduledAt");

-- CreateIndex
CREATE INDEX "visits_tenantId_status_idx" ON "visits"("tenantId", "status");

-- CreateIndex
CREATE INDEX "visits_recordingExpiresAt_idx" ON "visits"("recordingExpiresAt");

-- CreateIndex
CREATE INDEX "lease_templates_type_isActive_idx" ON "lease_templates"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "lease_templates_code_version_key" ON "lease_templates"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "leases_reference_key" ON "leases"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "leases_applicationId_key" ON "leases"("applicationId");

-- CreateIndex
CREATE INDEX "leases_status_idx" ON "leases"("status");

-- CreateIndex
CREATE INDEX "leases_tenantId_idx" ON "leases"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_payerId_type_idx" ON "payments"("payerId", "type");

-- CreateIndex
CREATE INDEX "payments_status_fundsStatus_idx" ON "payments"("status", "fundsStatus");

-- CreateIndex
CREATE INDEX "subscriptions_ownerId_status_idx" ON "subscriptions"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedules_code_key" ON "fee_schedules"("code");

-- CreateIndex
CREATE INDEX "fee_schedules_isActive_effectiveFrom_idx" ON "fee_schedules"("isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_registryNumber_key" ON "mandates"("registryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_propertyId_key" ON "mandates"("propertyId");

-- CreateIndex
CREATE INDEX "mandates_status_idx" ON "mandates"("status");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_files" ADD CONSTRAINT "tenant_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_tenantFileId_fkey" FOREIGN KEY ("tenantFileId") REFERENCES "tenant_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_tenantFileId_fkey" FOREIGN KEY ("tenantFileId") REFERENCES "tenant_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_tenantFileId_fkey" FOREIGN KEY ("tenantFileId") REFERENCES "tenant_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenantFileId_fkey" FOREIGN KEY ("tenantFileId") REFERENCES "tenant_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_kycCheckId_fkey" FOREIGN KEY ("kycCheckId") REFERENCES "kyc_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "lease_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "fee_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "fee_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
