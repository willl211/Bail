-- Fusion des rôles internes : AGENT couvre désormais l'agent de terrain et
-- l'administrateur du back-office. La valeur ADMIN n'a jamais été utilisée
-- (aucune ligne `users` ne la porte, aucun code ne la référence).
-- Décision du 2 septembre 2026 — à réintroduire seulement si un périmètre
-- distinct apparaît.

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('OWNER', 'TENANT', 'AGENT');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
COMMIT;
