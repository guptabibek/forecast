-- ═══════════════════════════════════════════════════════════════════════════
-- Production Branch Module: Lines, Stations, Downtime, Scrap Reasons
-- ═══════════════════════════════════════════════════════════════════════════

-- Production Lines
CREATE TABLE "production_lines" (
    "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"   UUID NOT NULL,
    "code"        VARCHAR(50) NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "description" TEXT,
    "location_id" UUID,
    "status"      "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "output_rate" DECIMAL(18,4),
    "output_uom"  VARCHAR(10),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_lines_tenant_id_code_key" ON "production_lines"("tenant_id", "code");
CREATE INDEX "production_lines_tenant_id_idx" ON "production_lines"("tenant_id");

-- Production Line Stations
CREATE TABLE "production_line_stations" (
    "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
    "production_line_id" UUID NOT NULL,
    "work_center_id"     UUID NOT NULL,
    "sequence"           INTEGER NOT NULL DEFAULT 10,
    "station_name"       VARCHAR(255),
    "is_bottleneck"      BOOLEAN NOT NULL DEFAULT false,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_line_stations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_line_stations_production_line_id_sequence_key" ON "production_line_stations"("production_line_id", "sequence");
CREATE INDEX "production_line_stations_production_line_id_idx" ON "production_line_stations"("production_line_id");

ALTER TABLE "production_line_stations" ADD CONSTRAINT "production_line_stations_production_line_id_fkey"
    FOREIGN KEY ("production_line_id") REFERENCES "production_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Downtime Reasons (Master)
CREATE TABLE "downtime_reasons" (
    "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"  UUID NOT NULL,
    "code"       VARCHAR(50) NOT NULL,
    "name"       VARCHAR(255) NOT NULL,
    "category"   VARCHAR(50) NOT NULL DEFAULT 'UNPLANNED',
    "is_planned" BOOLEAN NOT NULL DEFAULT false,
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "downtime_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "downtime_reasons_tenant_id_code_key" ON "downtime_reasons"("tenant_id", "code");
CREATE INDEX "downtime_reasons_tenant_id_idx" ON "downtime_reasons"("tenant_id");

-- Downtime Records
CREATE TABLE "downtime_records" (
    "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"          UUID NOT NULL,
    "downtime_reason_id" UUID NOT NULL,
    "production_line_id" UUID,
    "work_order_id"      UUID,
    "start_time"         TIMESTAMP(3) NOT NULL,
    "end_time"           TIMESTAMP(3),
    "duration_minutes"   DECIMAL(10,2),
    "notes"              TEXT,
    "reported_by_id"     UUID,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "downtime_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "downtime_records_tenant_id_production_line_id_idx" ON "downtime_records"("tenant_id", "production_line_id");
CREATE INDEX "downtime_records_tenant_id_start_time_idx" ON "downtime_records"("tenant_id", "start_time");

ALTER TABLE "downtime_records" ADD CONSTRAINT "downtime_records_downtime_reason_id_fkey"
    FOREIGN KEY ("downtime_reason_id") REFERENCES "downtime_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "downtime_records" ADD CONSTRAINT "downtime_records_production_line_id_fkey"
    FOREIGN KEY ("production_line_id") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Scrap Reasons (Master)
CREATE TABLE "scrap_reasons" (
    "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"  UUID NOT NULL,
    "code"       VARCHAR(50) NOT NULL,
    "name"       VARCHAR(255) NOT NULL,
    "category"   VARCHAR(100),
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scrap_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scrap_reasons_tenant_id_code_key" ON "scrap_reasons"("tenant_id", "code");
CREATE INDEX "scrap_reasons_tenant_id_idx" ON "scrap_reasons"("tenant_id");
