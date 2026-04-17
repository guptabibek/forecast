-- AlterTable: add must_reset_password to users
ALTER TABLE "users" ADD COLUMN "must_reset_password" BOOLEAN NOT NULL DEFAULT false;

-- Set must_reset_password for all PENDING users (they have temp passwords)
UPDATE "users" SET "must_reset_password" = true WHERE "status" = 'PENDING';
