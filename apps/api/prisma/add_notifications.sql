-- Create notification enums
DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM ('INFO', 'WARNING', 'ERROR', 'SUCCESS', 'APPROVAL_REQUIRED', 'APPROVAL_COMPLETED', 'INVENTORY_LOW', 'MRP_EXCEPTION', 'WORK_ORDER_DELAY', 'PO_DUE', 'IMPORT_COMPLETE', 'FORECAST_COMPLETE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create notifications table
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "title" VARCHAR(255) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" UUID,
    "action_url" VARCHAR(500),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "notifications_tenant_id_user_id_is_read_idx" ON "notifications"("tenant_id", "user_id", "is_read");
CREATE INDEX IF NOT EXISTS "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_tenant_id_type_idx" ON "notifications"("tenant_id", "type");
