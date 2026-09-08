ALTER TYPE "AuthTokenPurpose" ADD VALUE 'EMAIL_CHANGE';
ALTER TABLE "auth_tokens" ADD COLUMN "targetEmail" TEXT, ADD COLUMN "sourceEmail" TEXT;
