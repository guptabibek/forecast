-- Backfill AI Reporting permissions into existing tenant system roles.
--
-- New role templates already include these permissions. This migration fixes
-- tenants whose system roles were seeded before AI Reporting existed.

WITH role_permission_additions(slug, permissions) AS (
  VALUES
    (
      'admin',
      '[
        "reports.ai.view",
        "reports.ai.execute",
        "reports.ai.dashboard",
        "reports.ai_reporting.view",
        "reports.ai_reporting.execute",
        "reports.sales.view",
        "reports.purchase.view",
        "reports.inventory.view",
        "reports.outstanding.view",
        "reports.accounting.view",
        "reports.tax.view"
      ]'::jsonb
    ),
    (
      'planner',
      '[
        "reports.ai.view",
        "reports.ai.execute",
        "reports.ai.dashboard",
        "reports.ai_reporting.view",
        "reports.ai_reporting.execute",
        "reports.sales.view",
        "reports.purchase.view",
        "reports.inventory.view",
        "reports.outstanding.view",
        "reports.accounting.view",
        "reports.tax.view"
      ]'::jsonb
    ),
    (
      'forecast-planner',
      '[
        "reports.ai.view",
        "reports.ai.execute",
        "reports.ai.dashboard",
        "reports.ai_reporting.view",
        "reports.ai_reporting.execute",
        "reports.sales.view",
        "reports.purchase.view",
        "reports.inventory.view",
        "reports.outstanding.view",
        "reports.accounting.view",
        "reports.tax.view"
      ]'::jsonb
    ),
    (
      'finance',
      '[
        "reports.ai.view",
        "reports.ai.execute",
        "reports.ai.dashboard",
        "reports.ai_reporting.view",
        "reports.ai_reporting.execute",
        "reports.sales.view",
        "reports.purchase.view",
        "reports.inventory.view",
        "reports.outstanding.view",
        "reports.accounting.view",
        "reports.tax.view"
      ]'::jsonb
    ),
    (
      'viewer',
      '[
        "reports.ai.view",
        "reports.ai.execute",
        "reports.ai.dashboard",
        "reports.ai_reporting.view",
        "reports.ai_reporting.execute",
        "reports.sales.view",
        "reports.purchase.view",
        "reports.inventory.view"
      ]'::jsonb
    ),
    (
      'forecast-viewer',
      '[
        "reports.ai.view",
        "reports.ai.execute",
        "reports.ai.dashboard",
        "reports.ai_reporting.view",
        "reports.ai_reporting.execute",
        "reports.sales.view",
        "reports.purchase.view",
        "reports.inventory.view"
      ]'::jsonb
    )
)
UPDATE "tenant_roles" tr
SET
  "permissions" = (
    SELECT jsonb_agg(permission ORDER BY permission)
    FROM (
      SELECT DISTINCT permission
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(tr."permissions") = 'array' THEN tr."permissions"
          ELSE '[]'::jsonb
        END
      ) AS existing_permissions(permission)
      UNION
      SELECT permission
      FROM jsonb_array_elements_text(role_permission_additions.permissions) AS added_permissions(permission)
    ) merged_permissions
  ),
  "module_access" = jsonb_set(
    CASE
      WHEN jsonb_typeof(tr."module_access") = 'object' THEN tr."module_access"
      ELSE '{}'::jsonb
    END,
    '{reports}',
    'true'::jsonb,
    true
  ),
  "updated_at" = CURRENT_TIMESTAMP
FROM role_permission_additions
WHERE tr."is_system" = true
  AND tr."slug" = role_permission_additions.slug;
