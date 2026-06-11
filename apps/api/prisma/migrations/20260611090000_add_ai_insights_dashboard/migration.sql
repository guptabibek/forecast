-- AI Insights Dashboard — additive only. No existing tables are modified.

-- CreateTable: per-user dashboards for pinned AI report widgets
CREATE TABLE "ai_dashboards" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable: widgets pinned to a dashboard (stores validated semantic query, never SQL)
CREATE TABLE "ai_dashboard_widgets" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "dashboard_id" UUID NOT NULL,
    "widget_type" VARCHAR(40) NOT NULL DEFAULT 'pinned_report',
    "title" VARCHAR(200) NOT NULL,
    "question" VARCHAR(1000),
    "source_request_id" UUID,
    "semantic_query" JSONB NOT NULL,
    "viz_type" VARCHAR(20),
    "filters" JSONB,
    "size" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "position" INTEGER NOT NULL DEFAULT 0,
    "refresh_interval_sec" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable: system-generated insights
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "provider_id" VARCHAR(80) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "title" VARCHAR(300) NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DECIMAL(5,4),
    "metrics" JSONB,
    "evidence" JSONB,
    "actions" JSONB,
    "drill_down_question" VARCHAR(1000),
    "dedupe_key" VARCHAR(200) NOT NULL,
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable: insight lifecycle audit trail
CREATE TABLE "ai_insight_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "insight_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "note" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insight_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: per-tenant provider enablement + run bookkeeping
CREATE TABLE "ai_insight_provider_configs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "provider_id" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "last_run_at" TIMESTAMP(3),
    "last_status" VARCHAR(20),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_insight_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_dashboards_tenant_id_user_id_name_key" ON "ai_dashboards"("tenant_id", "user_id", "name");
CREATE INDEX "ai_dashboards_tenant_id_user_id_idx" ON "ai_dashboards"("tenant_id", "user_id");

CREATE INDEX "ai_dashboard_widgets_tenant_id_dashboard_id_position_idx" ON "ai_dashboard_widgets"("tenant_id", "dashboard_id", "position");
CREATE INDEX "ai_dashboard_widgets_tenant_id_user_id_idx" ON "ai_dashboard_widgets"("tenant_id", "user_id");

CREATE UNIQUE INDEX "ai_insights_tenant_id_provider_id_dedupe_key_key" ON "ai_insights"("tenant_id", "provider_id", "dedupe_key");
CREATE INDEX "ai_insights_tenant_id_status_severity_last_evaluated_at_idx" ON "ai_insights"("tenant_id", "status", "severity", "last_evaluated_at");
CREATE INDEX "ai_insights_tenant_id_category_created_at_idx" ON "ai_insights"("tenant_id", "category", "created_at");

CREATE INDEX "ai_insight_events_tenant_id_insight_id_created_at_idx" ON "ai_insight_events"("tenant_id", "insight_id", "created_at");

CREATE UNIQUE INDEX "ai_insight_provider_configs_tenant_id_provider_id_key" ON "ai_insight_provider_configs"("tenant_id", "provider_id");

-- AddForeignKey (between NEW tables only — existing tables untouched)
ALTER TABLE "ai_dashboard_widgets"
    ADD CONSTRAINT "ai_dashboard_widgets_dashboard_id_fkey"
    FOREIGN KEY ("dashboard_id") REFERENCES "ai_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_insight_events"
    ADD CONSTRAINT "ai_insight_events_insight_id_fkey"
    FOREIGN KEY ("insight_id") REFERENCES "ai_insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
