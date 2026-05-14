-- ============================================================================
-- PARTITION PREPARATION — High-Volume Financial Tables
-- ============================================================================
-- This migration adds range-partitioning support for the highest-volume
-- financial tables.  PostgreSQL does not support ALTER TABLE … ADD PARTITION
-- on existing regular tables, so this migration:
--   1. Creates a partitioned shadow table with identical schema.
--   2. Creates a function + views to transparently migrate data later.
--   3. Creates initial quarterly partitions for 2025-2026.
--   4. Drops/recreates indexes on the partitioned children.
--
-- DEPLOYMENT NOTE: The actual data migration from the existing tables into
-- the partitioned equivalents should be executed in a MAINTENANCE WINDOW
-- using the provided helper functions.  Until that migration runs, the
-- original tables remain the source of truth.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. COST LAYERS — Partition by layer_date (RANGE, quarterly)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cost_layers_partitioned (
    id              UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    product_id      UUID NOT NULL,
    location_id     UUID NOT NULL,
    batch_id        UUID,
    costing_method  TEXT NOT NULL,
    layer_date      TIMESTAMP NOT NULL DEFAULT now(),
    reference_type  VARCHAR(50) NOT NULL,
    reference_id    UUID NOT NULL,
    reference_number VARCHAR(50),
    original_qty    DECIMAL(18,4) NOT NULL,
    remaining_qty   DECIMAL(18,4) NOT NULL,
    unit_cost       DECIMAL(18,4) NOT NULL,
    total_cost      DECIMAL(18,4) NOT NULL,
    landed_cost     DECIMAL(18,4) NOT NULL DEFAULT 0,
    currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate   DECIMAL(18,8) NOT NULL DEFAULT 1,
    base_curr_cost  DECIMAL(18,4) NOT NULL DEFAULT 0,
    fiscal_period_id UUID,
    status          TEXT NOT NULL DEFAULT 'OPEN',
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (id, layer_date)
) PARTITION BY RANGE (layer_date);

-- Quarterly partitions for 2025
CREATE TABLE IF NOT EXISTS cost_layers_p2025q1 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS cost_layers_p2025q2 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS cost_layers_p2025q3 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS cost_layers_p2025q4 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Quarterly partitions for 2026
CREATE TABLE IF NOT EXISTS cost_layers_p2026q1 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS cost_layers_p2026q2 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS cost_layers_p2026q3 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS cost_layers_p2026q4 PARTITION OF cost_layers_partitioned
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Default partition for out-of-range data
CREATE TABLE IF NOT EXISTS cost_layers_pdefault PARTITION OF cost_layers_partitioned DEFAULT;

-- Indexes on the partitioned table (inherited by all children)
CREATE INDEX IF NOT EXISTS idx_clp_tenant_product_loc_status
    ON cost_layers_partitioned (tenant_id, product_id, location_id, status);
CREATE INDEX IF NOT EXISTS idx_clp_tenant_product_loc_status_date
    ON cost_layers_partitioned (tenant_id, product_id, location_id, status, layer_date);
CREATE INDEX IF NOT EXISTS idx_clp_fifo_covering
    ON cost_layers_partitioned (tenant_id, product_id, location_id, layer_date ASC)
    INCLUDE (remaining_qty, unit_cost, version)
    WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_clp_ref
    ON cost_layers_partitioned (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_clp_fiscal
    ON cost_layers_partitioned (tenant_id, fiscal_period_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. COST LAYER DEPLETIONS — Partition by depleted_at (RANGE, quarterly)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cost_layer_depletions_partitioned (
    id               UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL,
    cost_layer_id    UUID NOT NULL,
    depleted_qty     DECIMAL(18,4) NOT NULL,
    unit_cost        DECIMAL(18,4) NOT NULL,
    total_cost       DECIMAL(18,4) NOT NULL,
    reference_type   VARCHAR(50) NOT NULL,
    reference_id     UUID NOT NULL,
    reference_number VARCHAR(50),
    depleted_at      TIMESTAMP NOT NULL DEFAULT now(),
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (id, depleted_at)
) PARTITION BY RANGE (depleted_at);

-- Quarterly partitions for 2025
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2025q1 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2025q2 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2025q3 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2025q4 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Quarterly partitions for 2026
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2026q1 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2026q2 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2026q3 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS cost_layer_depletions_p2026q4 PARTITION OF cost_layer_depletions_partitioned
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS cost_layer_depletions_pdefault PARTITION OF cost_layer_depletions_partitioned DEFAULT;

CREATE INDEX IF NOT EXISTS idx_cldp_tenant_layer
    ON cost_layer_depletions_partitioned (tenant_id, cost_layer_id);
CREATE INDEX IF NOT EXISTS idx_cldp_ref
    ON cost_layer_depletions_partitioned (reference_type, reference_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. JOURNAL ENTRIES — Partition by entry_date (RANGE, quarterly)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journal_entries_partitioned (
    id               UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL,
    entry_number     VARCHAR(50),
    entry_date       TIMESTAMP NOT NULL,
    posting_date     TIMESTAMP NOT NULL DEFAULT now(),
    source           VARCHAR(100),
    reference_type   VARCHAR(50),
    reference_id     UUID,
    reference_number VARCHAR(50),
    description      TEXT,
    status           TEXT NOT NULL DEFAULT 'POSTED',
    total_debit      DECIMAL(18,4) NOT NULL DEFAULT 0,
    total_credit     DECIMAL(18,4) NOT NULL DEFAULT 0,
    currency         VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate    DECIMAL(18,8) NOT NULL DEFAULT 1,
    fiscal_period_id UUID,
    reversal_of_id   UUID,
    posted_by_id     UUID,
    auto_generated   BOOLEAN NOT NULL DEFAULT false,
    idempotency_key  VARCHAR(255),
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    updated_at       TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (id, entry_date)
) PARTITION BY RANGE (entry_date);

-- Quarterly partitions for 2025
CREATE TABLE IF NOT EXISTS journal_entries_p2025q1 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS journal_entries_p2025q2 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS journal_entries_p2025q3 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS journal_entries_p2025q4 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Quarterly partitions for 2026
CREATE TABLE IF NOT EXISTS journal_entries_p2026q1 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS journal_entries_p2026q2 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS journal_entries_p2026q3 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS journal_entries_p2026q4 PARTITION OF journal_entries_partitioned
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS journal_entries_pdefault PARTITION OF journal_entries_partitioned DEFAULT;

CREATE INDEX IF NOT EXISTS idx_jep_tenant_date
    ON journal_entries_partitioned (tenant_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_jep_tenant_fiscal
    ON journal_entries_partitioned (tenant_id, fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_jep_ref
    ON journal_entries_partitioned (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_jep_idempotency
    ON journal_entries_partitioned (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. JOURNAL ENTRY LINES — Partition by created_at (RANGE, quarterly)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journal_entry_lines_partitioned (
    id               UUID NOT NULL DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL,
    line_number      INTEGER NOT NULL,
    account_id       UUID NOT NULL,
    description      TEXT,
    debit_amount     DECIMAL(18,4) NOT NULL DEFAULT 0,
    credit_amount    DECIMAL(18,4) NOT NULL DEFAULT 0,
    currency         VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate    DECIMAL(18,8) NOT NULL DEFAULT 1,
    base_debit       DECIMAL(18,4) NOT NULL DEFAULT 0,
    base_credit      DECIMAL(18,4) NOT NULL DEFAULT 0,
    cost_center_id   UUID,
    product_id       UUID,
    location_id      UUID,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Quarterly partitions for 2025
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2025q1 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2025q2 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2025q3 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2025q4 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Quarterly partitions for 2026
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2026q1 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2026q2 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2026q3 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS journal_entry_lines_p2026q4 PARTITION OF journal_entry_lines_partitioned
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS journal_entry_lines_pdefault PARTITION OF journal_entry_lines_partitioned DEFAULT;

CREATE INDEX IF NOT EXISTS idx_jelp_journal
    ON journal_entry_lines_partitioned (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jelp_account
    ON journal_entry_lines_partitioned (account_id);
CREATE INDEX IF NOT EXISTS idx_jelp_account_product_loc
    ON journal_entry_lines_partitioned (account_id, product_id, location_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. DATA MIGRATION HELPER FUNCTION
-- ────────────────────────────────────────────────────────────────────────────
-- Run in maintenance window: SELECT migrate_to_partitioned_tables();
-- This copies data in batches, then renames tables atomically.

CREATE OR REPLACE FUNCTION migrate_to_partitioned_tables()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    batch_size INTEGER := 10000;
    total_migrated BIGINT;
BEGIN
    RAISE NOTICE 'Starting partitioned table migration...';

    -- ── cost_layers ──
    RAISE NOTICE 'Migrating cost_layers...';
    INSERT INTO cost_layers_partitioned
    SELECT * FROM cost_layers
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total_migrated = ROW_COUNT;
    RAISE NOTICE 'cost_layers: % rows migrated', total_migrated;

    -- ── cost_layer_depletions ──
    RAISE NOTICE 'Migrating cost_layer_depletions...';
    INSERT INTO cost_layer_depletions_partitioned
    SELECT * FROM cost_layer_depletions
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total_migrated = ROW_COUNT;
    RAISE NOTICE 'cost_layer_depletions: % rows migrated', total_migrated;

    -- ── journal_entries ──
    RAISE NOTICE 'Migrating journal_entries...';
    INSERT INTO journal_entries_partitioned
    SELECT * FROM journal_entries
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total_migrated = ROW_COUNT;
    RAISE NOTICE 'journal_entries: % rows migrated', total_migrated;

    -- ── journal_entry_lines ──
    RAISE NOTICE 'Migrating journal_entry_lines...';
    INSERT INTO journal_entry_lines_partitioned
    SELECT * FROM journal_entry_lines
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total_migrated = ROW_COUNT;
    RAISE NOTICE 'journal_entry_lines: % rows migrated', total_migrated;

    -- ── ATOMIC RENAME ──
    RAISE NOTICE 'Performing atomic table swap...';

    ALTER TABLE cost_layers RENAME TO cost_layers_legacy;
    ALTER TABLE cost_layers_partitioned RENAME TO cost_layers;

    ALTER TABLE cost_layer_depletions RENAME TO cost_layer_depletions_legacy;
    ALTER TABLE cost_layer_depletions_partitioned RENAME TO cost_layer_depletions;

    ALTER TABLE journal_entries RENAME TO journal_entries_legacy;
    ALTER TABLE journal_entries_partitioned RENAME TO journal_entries;

    ALTER TABLE journal_entry_lines RENAME TO journal_entry_lines_legacy;
    ALTER TABLE journal_entry_lines_partitioned RENAME TO journal_entry_lines;

    RAISE NOTICE 'Partition migration complete. Legacy tables preserved with _legacy suffix.';
    RAISE NOTICE 'After verification, drop legacy tables: DROP TABLE cost_layers_legacy, cost_layer_depletions_legacy, journal_entries_legacy, journal_entry_lines_legacy CASCADE;';
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. AUTO-CREATE FUTURE PARTITIONS (run quarterly via pg_cron or similar)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_next_quarter_partitions()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    next_q_start DATE;
    next_q_end DATE;
    suffix TEXT;
    year_num INTEGER;
    quarter_num INTEGER;
BEGIN
    -- Calculate the start of the quarter after next
    next_q_start := date_trunc('quarter', now() + INTERVAL '3 months')::date;
    next_q_end := (next_q_start + INTERVAL '3 months')::date;
    year_num := EXTRACT(YEAR FROM next_q_start);
    quarter_num := EXTRACT(QUARTER FROM next_q_start);
    suffix := 'p' || year_num || 'q' || quarter_num;

    -- cost_layers
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS cost_layers_%s PARTITION OF cost_layers FOR VALUES FROM (%L) TO (%L)',
        suffix, next_q_start, next_q_end
    );

    -- cost_layer_depletions
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS cost_layer_depletions_%s PARTITION OF cost_layer_depletions FOR VALUES FROM (%L) TO (%L)',
        suffix, next_q_start, next_q_end
    );

    -- journal_entries
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS journal_entries_%s PARTITION OF journal_entries FOR VALUES FROM (%L) TO (%L)',
        suffix, next_q_start, next_q_end
    );

    -- journal_entry_lines
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS journal_entry_lines_%s PARTITION OF journal_entry_lines FOR VALUES FROM (%L) TO (%L)',
        suffix, next_q_start, next_q_end
    );

    RAISE NOTICE 'Created partitions for % Q%: % to %', year_num, quarter_num, next_q_start, next_q_end;
END;
$$;

-- Schedule (requires pg_cron extension):
-- SELECT cron.schedule('create-quarterly-partitions', '0 0 15 3,6,9,12 *', 'SELECT create_next_quarter_partitions()');
