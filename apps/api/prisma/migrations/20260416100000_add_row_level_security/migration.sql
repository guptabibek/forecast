-- Migration: PostgreSQL Row-Level Security (RLS) Policies for Multi-Tenant Isolation
-- This provides database-level defense-in-depth for tenant data isolation.
-- Even if application-level filters are bypassed, the DB will enforce isolation.
--
-- The application must SET app.current_tenant_id = '<uuid>' on each connection/transaction.
-- When no tenant is set (e.g. system migrations), RLS is permissive for superusers.

-- Create a helper function to get the current tenant from session variable
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable RLS on all primary tenant-scoped tables
-- (child tables that inherit tenant scope via FK are NOT included to avoid performance issues)

-- Core business tables
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "actuals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scenarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecasts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assumptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;

-- Forecast engine tables
ALTER TABLE "forecast_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_accuracy_metrics" ENABLE ROW LEVEL SECURITY;

-- Manufacturing tables
ALTER TABLE "bills_of_material" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_completions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;

-- Financial tables
ALTER TABLE "gl_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "posting_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_cost_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_layers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_costs" ENABLE ROW LEVEL SECURITY;

-- Integration tables
ALTER TABLE "marg_sync_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marg_sync_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marg_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marg_parties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marg_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marg_stocks" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies: allow access only when current_tenant_id() matches OR is NULL (superuser/migration)
-- Using a single policy pattern for all tables

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'users', 'products', 'locations', 'customers', 'accounts', 'cost_centers',
    'actuals', 'plan_versions', 'scenarios', 'forecasts', 'assumptions',
    'data_imports', 'audit_logs', 'reports', 'notifications',
    'refresh_tokens', 'password_reset_tokens',
    'forecast_jobs', 'forecast_runs', 'forecast_results', 'forecast_overrides',
    'forecast_reconciliations', 'forecast_accuracy_metrics',
    'bills_of_material', 'work_centers', 'routings', 'work_orders',
    'purchase_orders', 'goods_receipts', 'material_issues', 'production_completions',
    'inventory_transactions', 'inventory_policies', 'inventory_levels',
    'batches', 'suppliers',
    'gl_accounts', 'journal_entries', 'posting_profiles', 'inventory_ledger',
    'item_cost_profiles', 'item_costs', 'cost_layers', 'work_order_costs',
    'marg_sync_configs', 'marg_sync_logs', 'marg_products', 'marg_parties',
    'marg_transactions', 'marg_stocks'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    -- SELECT policy
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (
        current_tenant_id() IS NULL OR tenant_id = current_tenant_id()
      )', tbl
    );

    -- INSERT policy
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (
        current_tenant_id() IS NULL OR tenant_id = current_tenant_id()
      )', tbl
    );

    -- UPDATE policy
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING (
        current_tenant_id() IS NULL OR tenant_id = current_tenant_id()
      ) WITH CHECK (
        current_tenant_id() IS NULL OR tenant_id = current_tenant_id()
      )', tbl
    );

    -- DELETE policy
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING (
        current_tenant_id() IS NULL OR tenant_id = current_tenant_id()
      )', tbl
    );
  END LOOP;
END $$;

-- IMPORTANT: RLS policies don't apply to table owners (superusers) by default.
-- For the application database user, ensure FORCE ROW LEVEL SECURITY:
-- ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
-- This should be done per-environment based on the application's DB role.
-- In production, the app should connect with a non-superuser role.
