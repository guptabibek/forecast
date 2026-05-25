-- CreateTable: per-tenant forecasting defaults provisioned by platform admins
CREATE TABLE "forecast_model_configs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "enabled_models" TEXT[],
    "default_model" VARCHAR(50) NOT NULL,
    "default_confidence_level" INTEGER NOT NULL DEFAULT 95,
    "default_history_months" INTEGER NOT NULL DEFAULT 24,
    "default_season_length" INTEGER NOT NULL DEFAULT 12,
    "default_horizon" INTEGER NOT NULL DEFAULT 12,
    "auto_select_best" BOOLEAN NOT NULL DEFAULT false,
    "provisioned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecast_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forecast_model_configs_tenant_id_key" ON "forecast_model_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "forecast_model_configs"
    ADD CONSTRAINT "forecast_model_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
