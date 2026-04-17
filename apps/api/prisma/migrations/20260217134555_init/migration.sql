-- CreateExtension
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pgcrypto extension already exists or requires superuser — skipping';
END $$;

-- CreateExtension
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'uuid-ossp extension already exists or requires superuser — skipping';
END $$;

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenantTier" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PLANNER', 'FINANCE', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING', 'LOCKED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'STORE', 'DISTRIBUTION_CENTER', 'PLANT', 'OFFICE', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('DIRECT', 'DISTRIBUTOR', 'RETAILER', 'WHOLESALE', 'ECOMMERCE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('REVENUE', 'COST_OF_GOODS', 'OPERATING_EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY');

-- CreateEnum
CREATE TYPE "DimensionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActualType" AS ENUM ('SALES', 'PURCHASES', 'INVENTORY', 'REVENUE', 'EXPENSE', 'HEADCOUNT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('BUDGET', 'FORECAST', 'STRATEGIC', 'WHAT_IF');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScenarioType" AS ENUM ('BASE', 'OPTIMISTIC', 'PESSIMISTIC', 'STRETCH', 'CONSERVATIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ForecastModel" AS ENUM ('MOVING_AVERAGE', 'WEIGHTED_AVERAGE', 'LINEAR_REGRESSION', 'HOLT_WINTERS', 'SEASONAL_NAIVE', 'YOY_GROWTH', 'TREND_PERCENT', 'AI_HYBRID', 'ARIMA', 'PROPHET', 'MANUAL');

-- CreateEnum
CREATE TYPE "AssumptionType" AS ENUM ('GROWTH_RATE', 'PRICE_CHANGE', 'VOLUME_CHANGE', 'COST_INFLATION', 'SEASONALITY', 'PROMOTION', 'NEW_PRODUCT', 'DISCONTINUATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ValueType" AS ENUM ('PERCENTAGE', 'ABSOLUTE', 'MULTIPLIER', 'INDEX');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('CSV', 'XLSX', 'XLS', 'JSON', 'API');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('SALES', 'PURCHASES', 'INVENTORY', 'FINANCIALS', 'PRODUCTS', 'LOCATIONS', 'CUSTOMERS', 'MIXED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'VALIDATING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIALLY_COMPLETED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 'IMPORT', 'LOGIN', 'LOGOUT', 'APPROVE', 'LOCK', 'UNLOCK');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FiscalCalendarType" AS ENUM ('CALENDAR', 'FISCAL_445', 'FISCAL_454', 'FISCAL_544', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BOMType" AS ENUM ('MANUFACTURING', 'ENGINEERING', 'SALES', 'PHANTOM');

-- CreateEnum
CREATE TYPE "BOMStatus" AS ENUM ('DRAFT', 'ACTIVE', 'OBSOLETE', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('STOCK', 'DIRECT_PURCHASE', 'SUBCONTRACT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "WorkCenterType" AS ENUM ('MACHINE', 'LABOR', 'TOOL', 'SUBCONTRACT', 'MIXED');

-- CreateEnum
CREATE TYPE "PlanningMethod" AS ENUM ('MRP', 'REORDER_POINT', 'MIN_MAX', 'KANBAN', 'VMI');

-- CreateEnum
CREATE TYPE "LotSizingRule" AS ENUM ('LFL', 'FOQ', 'EOQ', 'POQ', 'MIN_MAX');

-- CreateEnum
CREATE TYPE "SafetyStockMethod" AS ENUM ('FIXED', 'DAYS_OF_SUPPLY', 'SERVICE_LEVEL', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "MRPRunType" AS ENUM ('REGENERATIVE', 'NET_CHANGE', 'SELECTIVE');

-- CreateEnum
CREATE TYPE "PlannedOrderType" AS ENUM ('PURCHASE', 'PRODUCTION', 'TRANSFER', 'SUBCONTRACT');

-- CreateEnum
CREATE TYPE "PlannedOrderStatus" AS ENUM ('PLANNED', 'FIRMED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MRPExceptionType" AS ENUM ('PAST_DUE_ORDER', 'EXPEDITE', 'DEFER', 'CANCEL', 'SHORTAGE', 'EXCESS_INVENTORY', 'LEAD_TIME_VIOLATION', 'LOT_SIZE_VIOLATION', 'CAPACITY_OVERLOAD');

-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "WorkflowEntityType" AS ENUM ('PLAN_VERSION', 'SCENARIO', 'FORECAST_RUN', 'FORECAST_OVERRIDE', 'FORECAST_RECONCILIATION', 'FORECAST', 'PLANNED_ORDER', 'BOM', 'PROMOTION', 'PRICE_CHANGE');

-- CreateEnum
CREATE TYPE "OverrideStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('USER', 'ROLE', 'MANAGER', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'DELEGATE', 'RETURN', 'COMMENT', 'ESCALATE');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PRICE_DISCOUNT', 'BOGO', 'BUNDLE', 'REBATE', 'LOYALTY_POINTS', 'FREE_SHIPPING', 'FEATURE_AD', 'DISPLAY', 'COUPON', 'CLEARANCE');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'PLANNED', 'APPROVED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SOPStatus" AS ENUM ('PLANNING', 'DEMAND_REVIEW', 'SUPPLY_REVIEW', 'PRE_SOP', 'EXECUTIVE_SOP', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SOPForecastSource" AS ENUM ('STATISTICAL', 'SALES', 'MARKETING', 'FINANCE', 'OPERATIONS', 'CONSENSUS');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssumptionStatus" AS ENUM ('PENDING', 'VALIDATED', 'CHALLENGED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NPIStatus" AS ENUM ('CONCEPT', 'DEVELOPMENT', 'PILOT', 'LAUNCH', 'GROWTH', 'MATURITY', 'DECLINE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "LaunchCurveType" AS ENUM ('STANDARD', 'AGGRESSIVE', 'CONSERVATIVE', 'LINEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ExternalDataType" AS ENUM ('POS', 'WEATHER', 'ECONOMIC', 'SOCIAL_MEDIA', 'GOOGLE_TRENDS', 'COMPETITOR', 'IOT', 'CUSTOM_API');

-- CreateEnum
CREATE TYPE "FinancialPlanType" AS ENUM ('OPERATING_PLAN', 'BUDGET', 'FORECAST', 'ROLLING_FORECAST', 'STRATEGIC_PLAN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('PENDING', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('PLANNED', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LaborType" AS ENUM ('SETUP', 'RUN', 'IDLE', 'REWORK', 'TRAINING');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SCRAP', 'RETURN', 'PRODUCTION_RECEIPT', 'PRODUCTION_ISSUE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'WARNING', 'ERROR', 'SUCCESS', 'APPROVAL_REQUIRED', 'APPROVAL_COMPLETED', 'INVENTORY_LOW', 'MRP_EXCEPTION', 'WORK_ORDER_DELAY', 'PO_DUE', 'IMPORT_COMPLETE', 'FORECAST_COMPLETE');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "QualityInspectionType" AS ENUM ('INCOMING', 'IN_PROCESS', 'FINAL', 'RECEIVING');

-- CreateEnum
CREATE TYPE "QualityInspectionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'CONDITIONALLY_ACCEPTED');

-- CreateEnum
CREATE TYPE "CapacityPlanType" AS ENUM ('RCCP', 'CRP', 'FINITE', 'INFINITE');

-- CreateEnum
CREATE TYPE "PurchaseContractType" AS ENUM ('BLANKET', 'FRAMEWORK', 'QUANTITY', 'VALUE');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('STANDARD', 'ACTUAL', 'BUDGET', 'PLANNED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('CREATED', 'IN_PROCESS', 'AVAILABLE', 'QUARANTINE', 'EXPIRED', 'CONSUMED', 'RECALLED');

-- CreateEnum
CREATE TYPE "GLAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CONTRA_ASSET');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PostingTransactionType" AS ENUM ('GOODS_RECEIPT', 'MATERIAL_ISSUE', 'PRODUCTION_RECEIPT', 'INVENTORY_ADJUSTMENT', 'SCRAP', 'COST_VARIANCE', 'LABOR_ABSORPTION', 'OVERHEAD_ABSORPTION');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('LEDGER_RECEIPT', 'LEDGER_ISSUE', 'LEDGER_TRANSFER_OUT', 'LEDGER_TRANSFER_IN', 'LEDGER_ADJUSTMENT', 'LEDGER_SCRAP', 'LEDGER_RETURN', 'LEDGER_PRODUCTION_RECEIPT', 'LEDGER_PRODUCTION_ISSUE', 'LEDGER_HOLD', 'LEDGER_RELEASE', 'LEDGER_RESERVATION', 'LEDGER_UNRESERVATION');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('INV_AVAILABLE', 'INV_RESERVED', 'INV_ON_HOLD', 'INV_QUARANTINE', 'INV_IN_TRANSIT');

-- CreateEnum
CREATE TYPE "SamplingProcedure" AS ENUM ('FIXED', 'PERCENTAGE', 'AQL', 'SKIP_LOT');

-- CreateEnum
CREATE TYPE "CharacteristicType" AS ENUM ('QUANTITATIVE', 'QUALITATIVE', 'ATTRIBUTE');

-- CreateEnum
CREATE TYPE "NCRType" AS ENUM ('NCR_PRODUCT', 'NCR_PROCESS', 'NCR_MATERIAL', 'NCR_SUPPLIER');

-- CreateEnum
CREATE TYPE "NCRSeverity" AS ENUM ('NCR_CRITICAL', 'NCR_MAJOR', 'NCR_MINOR', 'NCR_OBSERVATION');

-- CreateEnum
CREATE TYPE "NCRStatus" AS ENUM ('NCR_OPEN', 'NCR_UNDER_REVIEW', 'NCR_DISPOSITION_PENDING', 'NCR_CORRECTIVE_ACTION', 'NCR_CLOSED', 'NCR_VOID');

-- CreateEnum
CREATE TYPE "NCRDisposition" AS ENUM ('USE_AS_IS', 'REWORK', 'NCR_SCRAP', 'RETURN_TO_SUPPLIER', 'SORT');

-- CreateEnum
CREATE TYPE "CAPAType" AS ENUM ('CORRECTIVE', 'PREVENTIVE');

-- CreateEnum
CREATE TYPE "CAPAStatus" AS ENUM ('CAPA_OPEN', 'CAPA_IN_PROGRESS', 'CAPA_VERIFICATION', 'CAPA_CLOSED', 'CAPA_CANCELLED');

-- CreateEnum
CREATE TYPE "CAPAPriority" AS ENUM ('CAPA_LOW', 'CAPA_MEDIUM', 'CAPA_HIGH', 'CAPA_CRITICAL');

-- CreateEnum
CREATE TYPE "ECOChangeType" AS ENUM ('EMERGENCY', 'ECO_STANDARD', 'ECO_MINOR');

-- CreateEnum
CREATE TYPE "ECOStatus" AS ENUM ('ECO_DRAFT', 'ECO_PENDING_REVIEW', 'ECO_APPROVED', 'ECO_IN_IMPLEMENTATION', 'ECO_COMPLETED', 'ECO_REJECTED', 'ECO_CANCELLED');

-- CreateEnum
CREATE TYPE "ECOItemType" AS ENUM ('ECO_PRODUCT', 'ECO_BOM', 'ECO_ROUTING', 'ECO_INSPECTION_PLAN');

-- CreateEnum
CREATE TYPE "ECOItemStatus" AS ENUM ('ECO_ITEM_PENDING', 'ECO_ITEM_IMPLEMENTED', 'ECO_ITEM_SKIPPED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "domain" VARCHAR(255),
    "subdomain" VARCHAR(100),
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "tier" "TenantTier" NOT NULL DEFAULT 'STARTER',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "logoUrl" VARCHAR(500),
    "primaryColor" VARCHAR(7),
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',
    "fiscalYearStart" INTEGER NOT NULL DEFAULT 1,
    "defaultCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 2555,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(50) NOT NULL DEFAULT 'line',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_mappings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "ssl_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "avatar_url" VARCHAR(500),
    "last_login_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(45),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100),
    "subcategory" VARCHAR(100),
    "brand" VARCHAR(100),
    "unit_of_measure" VARCHAR(20),
    "standard_cost" DECIMAL(18,4),
    "list_price" DECIMAL(18,4),
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "qc_required" BOOLEAN NOT NULL DEFAULT false,
    "batch_tracked" BOOLEAN NOT NULL DEFAULT false,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "external_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'WAREHOUSE',
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "region" VARCHAR(100),
    "timezone" VARCHAR(50),
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "external_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'DIRECT',
    "segment" VARCHAR(100),
    "industry" VARCHAR(100),
    "country" VARCHAR(100),
    "region" VARCHAR(100),
    "credit_limit" DECIMAL(18,2),
    "payment_terms" VARCHAR(50),
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "external_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "AccountType" NOT NULL,
    "category" VARCHAR(100),
    "parent_id" UUID,
    "level" INTEGER NOT NULL DEFAULT 1,
    "is_rollup" BOOLEAN NOT NULL DEFAULT false,
    "sign" INTEGER NOT NULL DEFAULT 1,
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "external_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "department" VARCHAR(100),
    "manager" VARCHAR(255),
    "parent_id" UUID,
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "external_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actuals" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "actual_type" "ActualType" NOT NULL,
    "period_date" DATE NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'MONTHLY',
    "product_id" UUID,
    "location_id" UUID,
    "customer_id" UUID,
    "account_id" UUID,
    "cost_center_id" UUID,
    "quantity" DECIMAL(18,4),
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "amount_local" DECIMAL(18,4),
    "currency_local" VARCHAR(3),
    "exchange_rate" DECIMAL(18,8),
    "source_system" VARCHAR(100),
    "source_reference" VARCHAR(255),
    "import_id" UUID,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "plan_type" "PlanType" NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'MONTHLY',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "locked_reason" VARCHAR(500),
    "approved_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "parent_version_id" UUID,
    "created_by_id" UUID NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "scenario_type" "ScenarioType" NOT NULL DEFAULT 'BASE',
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "locked_at" TIMESTAMP(3),
    "locked_reason" VARCHAR(500),
    "is_baseline" BOOLEAN NOT NULL DEFAULT false,
    "color" VARCHAR(7),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecasts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "forecast_run_id" UUID,
    "forecast_model" "ForecastModel" NOT NULL,
    "period_date" DATE NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'MONTHLY',
    "product_id" UUID,
    "location_id" UUID,
    "customer_id" UUID,
    "account_id" UUID,
    "cost_center_id" UUID,
    "forecast_quantity" DECIMAL(18,4),
    "forecast_amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "confidence_lower" DECIMAL(18,4),
    "confidence_upper" DECIMAL(18,4),
    "confidence_level" INTEGER,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "original_amount" DECIMAL(18,4),
    "override_reason" VARCHAR(500),
    "override_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "modified_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assumptions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "scenario_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "assumption_type" "AssumptionType" NOT NULL,
    "product_id" UUID,
    "location_id" UUID,
    "customer_id" UUID,
    "account_id" UUID,
    "value" DECIMAL(18,8) NOT NULL,
    "value_type" "ValueType" NOT NULL DEFAULT 'PERCENTAGE',
    "start_date" DATE,
    "end_date" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_type" "FileType" NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_path" VARCHAR(500),
    "import_type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "mapping_template_id" UUID,
    "column_mapping" JSONB,
    "total_rows" INTEGER,
    "processed_rows" INTEGER,
    "success_rows" INTEGER,
    "error_rows" INTEGER,
    "errors" JSONB,
    "error_file_path" VARCHAR(500),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_templates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "import_type" "ImportType" NOT NULL,
    "column_mapping" JSONB NOT NULL,
    "transformations" JSONB,
    "validations" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "action" "AuditAction" NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_fields" TEXT[],
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "request_id" VARCHAR(100),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_jobs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "forecast_run_id" UUID,
    "forecast_model" "ForecastModel" NOT NULL,
    "is_persistent" BOOLEAN NOT NULL DEFAULT true,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "parameters" JSONB NOT NULL,
    "dimensions" TEXT[],
    "start_period" DATE NOT NULL,
    "end_period" DATE NOT NULL,
    "result_count" INTEGER,
    "error_message" TEXT,
    "metrics" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecast_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_runs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "forecast_model" "ForecastModel" NOT NULL,
    "model_version" VARCHAR(50) NOT NULL,
    "is_persistent" BOOLEAN NOT NULL DEFAULT true,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "parameters" JSONB NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "start_period" DATE NOT NULL,
    "end_period" DATE NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecast_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_results" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "forecast_run_id" UUID NOT NULL,
    "period_date" DATE NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'MONTHLY',
    "product_id" UUID,
    "location_id" UUID,
    "customer_id" UUID,
    "account_id" UUID,
    "cost_center_id" UUID,
    "forecast_quantity" DECIMAL(18,4),
    "forecast_amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "confidence_lower" DECIMAL(18,4),
    "confidence_upper" DECIMAL(18,4),
    "confidence_level" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_overrides" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "forecast_run_id" UUID NOT NULL,
    "period_date" DATE NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'MONTHLY',
    "product_id" UUID,
    "location_id" UUID,
    "customer_id" UUID,
    "account_id" UUID,
    "cost_center_id" UUID,
    "original_amount" DECIMAL(18,4) NOT NULL,
    "override_amount" DECIMAL(18,4) NOT NULL,
    "original_quantity" DECIMAL(18,4),
    "override_quantity" DECIMAL(18,4),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "reason" VARCHAR(500) NOT NULL,
    "status" "OverrideStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approval_notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_reconciliations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "forecast_run_id" UUID NOT NULL,
    "actual_id" UUID,
    "period_date" DATE NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'MONTHLY',
    "product_id" UUID,
    "location_id" UUID,
    "customer_id" UUID,
    "account_id" UUID,
    "cost_center_id" UUID,
    "forecast_amount" DECIMAL(18,4) NOT NULL,
    "actual_amount" DECIMAL(18,4) NOT NULL,
    "variance_amount" DECIMAL(18,4) NOT NULL,
    "variance_pct" DECIMAL(8,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "threshold_pct" DECIMAL(8,4) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_buckets" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "calendar_id" UUID,
    "period_type" "PeriodType" NOT NULL,
    "period_key" VARCHAR(20) NOT NULL,
    "bucket_start" DATE NOT NULL,
    "bucket_end" DATE NOT NULL,
    "fiscal_year" INTEGER,
    "fiscal_quarter" INTEGER,
    "fiscal_month" INTEGER,
    "fiscal_week" INTEGER,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "from_currency" VARCHAR(3) NOT NULL,
    "to_currency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "as_of_date" DATE NOT NULL,
    "source" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_calendars" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "FiscalCalendarType" NOT NULL DEFAULT 'CALENDAR',
    "start_month" INTEGER NOT NULL DEFAULT 1,
    "week_start_day" INTEGER NOT NULL DEFAULT 0,
    "pattern_type" VARCHAR(20),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "calendar_id" UUID NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "fiscal_quarter" INTEGER NOT NULL,
    "fiscal_month" INTEGER NOT NULL,
    "fiscal_week" INTEGER,
    "period_name" VARCHAR(50) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "working_days" INTEGER NOT NULL DEFAULT 0,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "locked_by_id" UUID,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_hierarchies" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "level_count" INTEGER NOT NULL DEFAULT 4,
    "level_names" TEXT[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_hierarchies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_hierarchy_nodes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "hierarchy_id" UUID NOT NULL,
    "parent_id" UUID,
    "product_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "level" INTEGER NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_hierarchy_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills_of_material" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "parent_product_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "type" "BOMType" NOT NULL DEFAULT 'MANUFACTURING',
    "status" "BOMStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "base_quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "base_uom" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_of_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_components" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "bom_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 10,
    "quantity" DECIMAL(18,6) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "scrap_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lead_time_offset" INTEGER NOT NULL DEFAULT 0,
    "is_phantom" BOOLEAN NOT NULL DEFAULT false,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "supply_type" "SupplyType" NOT NULL DEFAULT 'STOCK',
    "operation_id" UUID,
    "effective_from" DATE,
    "effective_to" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_centers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" "WorkCenterType" NOT NULL DEFAULT 'MACHINE',
    "location_id" UUID,
    "cost_per_hour" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "setup_cost_per_hour" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "efficiency" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "utilization" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_center_capacities" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_center_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "capacity_per_day" DECIMAL(18,4) NOT NULL,
    "capacity_uom" VARCHAR(20) NOT NULL,
    "number_of_machines" INTEGER NOT NULL DEFAULT 1,
    "number_of_shifts" INTEGER NOT NULL DEFAULT 1,
    "hours_per_shift" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_center_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_center_shifts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_center_id" UUID NOT NULL,
    "shift_name" VARCHAR(50) NOT NULL,
    "start_time" VARCHAR(8) NOT NULL,
    "end_time" VARCHAR(8) NOT NULL,
    "days_of_week" INTEGER[],
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "work_center_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "status" "BOMStatus" NOT NULL DEFAULT 'ACTIVE',
    "total_lead_time" INTEGER NOT NULL DEFAULT 0,
    "total_setup_time" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_run_time" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_operations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "routing_id" UUID NOT NULL,
    "work_center_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 10,
    "operation_code" VARCHAR(50) NOT NULL,
    "operation_name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "setup_time" DECIMAL(10,4) NOT NULL,
    "run_time_per_unit" DECIMAL(10,6) NOT NULL,
    "wait_time" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "move_time" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "queue_time" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "overlap_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "minimum_transfer_qty" DECIMAL(18,4),
    "yield_percent" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "is_subcontracted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_policies" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "planning_method" "PlanningMethod" NOT NULL DEFAULT 'MRP',
    "lot_sizing_rule" "LotSizingRule" NOT NULL DEFAULT 'LFL',
    "safety_stock_method" "SafetyStockMethod" NOT NULL DEFAULT 'FIXED',
    "safety_stock_qty" DECIMAL(18,4),
    "safety_stock_days" INTEGER,
    "service_level" DECIMAL(5,2) NOT NULL DEFAULT 95,
    "reorder_point" DECIMAL(18,4),
    "reorder_qty" DECIMAL(18,4),
    "min_order_qty" DECIMAL(18,4),
    "max_order_qty" DECIMAL(18,4),
    "multiple_order_qty" DECIMAL(18,4),
    "lead_time_days" INTEGER NOT NULL DEFAULT 0,
    "safety_lead_time" INTEGER NOT NULL DEFAULT 0,
    "abc_class" VARCHAR(1),
    "xyz_class" VARCHAR(1),
    "shelf_life_days" INTEGER,
    "min_remaining_shelf_life" INTEGER,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "on_hand_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "allocated_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "available_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "in_transit_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "on_order_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reserved_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quarantine_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "standard_cost" DECIMAL(18,4),
    "average_cost" DECIMAL(18,4),
    "inventory_value" DECIMAL(18,4),
    "last_receipt_date" DATE,
    "last_issue_date" DATE,
    "last_count_date" DATE,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrp_runs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "run_type" "MRPRunType" NOT NULL DEFAULT 'REGENERATIVE',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "planning_horizon_days" INTEGER NOT NULL,
    "frozen_period_days" INTEGER NOT NULL DEFAULT 0,
    "location_ids" TEXT[],
    "product_ids" TEXT[],
    "respect_lead_times" BOOLEAN NOT NULL DEFAULT true,
    "consider_safety_stock" BOOLEAN NOT NULL DEFAULT true,
    "net_change" BOOLEAN NOT NULL DEFAULT false,
    "planned_order_count" INTEGER,
    "exception_count" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrp_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrp_requirements" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "mrp_run_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "period_date" DATE NOT NULL,
    "gross_requirement" DECIMAL(18,4) NOT NULL,
    "scheduled_receipts" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "projected_on_hand" DECIMAL(18,4) NOT NULL,
    "net_requirement" DECIMAL(18,4) NOT NULL,
    "planned_order_receipt" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "planned_order_release" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "demand_source" VARCHAR(100),
    "demand_source_id" UUID,

    CONSTRAINT "mrp_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "mrp_run_id" UUID,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "order_type" "PlannedOrderType" NOT NULL,
    "status" "PlannedOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "start_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "release_date" DATE,
    "quantity" DECIMAL(18,4) NOT NULL,
    "released_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "supplier_id" UUID,
    "source_location_id" UUID,
    "is_firmed" BOOLEAN NOT NULL DEFAULT false,
    "firmed_at" TIMESTAMP(3),
    "firmed_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planned_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrp_exceptions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "mrp_run_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "exception_type" "MRPExceptionType" NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "affected_date" DATE,
    "current_value" DECIMAL(18,4),
    "required_value" DECIMAL(18,4),
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrp_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "contact_name" VARCHAR(255),
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "address" TEXT,
    "country" VARCHAR(100),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "payment_terms" VARCHAR(50),
    "on_time_delivery_rate" DECIMAL(5,2),
    "quality_rating" DECIMAL(3,2),
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "external_id" VARCHAR(100),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "supplier_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "supplier_part_number" VARCHAR(100),
    "unit_price" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "min_order_qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "order_multiple" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "lead_time_days" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "daily_capacity" DECIMAL(18,4),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "inspection_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "entity_type" "WorkflowEntityType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "template_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "approver_type" "ApproverType" NOT NULL,
    "approver_role" "UserRole",
    "approver_user_id" UUID,
    "required_approvals" INTEGER NOT NULL DEFAULT 1,
    "auto_approve_after_days" INTEGER,
    "can_reject" BOOLEAN NOT NULL DEFAULT true,
    "can_delegate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "entity_type" "WorkflowEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_actions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "instance_id" UUID NOT NULL,
    "step_number" INTEGER NOT NULL,
    "action" "WorkflowActionType" NOT NULL,
    "performed_by" UUID NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "attachments" JSONB,

    CONSTRAINT "workflow_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "pre_order_start_date" DATE,
    "budget" DECIMAL(18,2),
    "actual_spend" DECIMAL(18,2),
    "expected_roi" DECIMAL(8,2),
    "actual_roi" DECIMAL(8,2),
    "discount_percent" DECIMAL(8,2),
    "discount_amount" DECIMAL(18,2),
    "marketing_spend" DECIMAL(18,2),
    "notes" TEXT,
    "product_ids" TEXT[],
    "location_ids" TEXT[],
    "customer_ids" TEXT[],
    "channel_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_lift_factors" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "promotion_id" UUID NOT NULL,
    "product_id" UUID,
    "location_id" UUID,
    "expected_lift" DECIMAL(8,4) NOT NULL,
    "expected_cannibalization" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "expected_halo" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "actual_lift" DECIMAL(8,4),
    "actual_cannibalization" DECIMAL(5,2),
    "actual_halo" DECIMAL(5,2),
    "confidence_level" DECIMAL(5,2),

    CONSTRAINT "promotion_lift_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_cycles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "fiscal_period" INTEGER NOT NULL,
    "status" "SOPStatus" NOT NULL DEFAULT 'PLANNING',
    "planning_start" DATE NOT NULL,
    "demand_review_date" DATE NOT NULL,
    "supply_review_date" DATE NOT NULL,
    "pre_sop_date" DATE NOT NULL,
    "executive_sop_date" DATE NOT NULL,
    "planning_end" DATE NOT NULL,
    "demand_manager" UUID,
    "supply_manager" UUID,
    "finance_manager" UUID,
    "executive_sponsor" UUID,
    "notes" TEXT,
    "decisions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_forecasts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "cycle_id" UUID NOT NULL,
    "source" "SOPForecastSource" NOT NULL,
    "total_units" DECIMAL(18,4) NOT NULL,
    "total_revenue" DECIMAL(18,2) NOT NULL,
    "period_forecasts" JSONB NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,

    CONSTRAINT "sop_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_assumptions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "cycle_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "assumption" TEXT NOT NULL,
    "impact" TEXT,
    "quantified_impact" DECIMAL(18,2),
    "risk" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "owner" UUID,
    "status" "AssumptionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "new_product_introductions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "status" "NPIStatus" NOT NULL DEFAULT 'CONCEPT',
    "concept_date" DATE,
    "development_date" DATE,
    "pilot_date" DATE,
    "launch_date" DATE,
    "maturity_date" DATE,
    "decline_date" DATE,
    "target_market" VARCHAR(255),
    "target_locations" TEXT[],
    "analog_product_ids" TEXT[],
    "launch_curve_type" "LaunchCurveType" NOT NULL DEFAULT 'STANDARD',
    "year1_units" DECIMAL(18,4),
    "year2_units" DECIMAL(18,4),
    "year3_units" DECIMAL(18,4),
    "peak_units" DECIMAL(18,4),
    "cannibalized_products" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "new_product_introductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_data_sources" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "ExternalDataType" NOT NULL,
    "connection_config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sync_frequency" VARCHAR(50) NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_data_points" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "source_id" UUID NOT NULL,
    "data_date" DATE NOT NULL,
    "product_id" UUID,
    "location_id" UUID,
    "metric_name" VARCHAR(100) NOT NULL,
    "metric_value" DECIMAL(18,6) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_data_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_plans" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "FinancialPlanType" NOT NULL,
    "status" "BOMStatus" NOT NULL DEFAULT 'DRAFT',
    "fiscal_year" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "total_revenue" DECIMAL(18,2),
    "total_cogs" DECIMAL(18,2),
    "gross_margin" DECIMAL(18,2),
    "gross_margin_pct" DECIMAL(8,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_plan_lines" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "financial_plan_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "product_id" UUID,
    "location_id" UUID,
    "customer_id" UUID,
    "cost_center_id" UUID,
    "fiscal_period" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "quantity" DECIMAL(18,4),
    "unit_price" DECIMAL(18,4),
    "budget_amount" DECIMAL(18,2),
    "prior_year_amount" DECIMAL(18,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_plan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "order_number" VARCHAR(50) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "expected_date" DATE NOT NULL,
    "received_date" DATE,
    "total_amount" DECIMAL(18,4),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "planned_order_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "purchase_order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "expected_date" DATE NOT NULL,
    "notes" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "receipt_number" VARCHAR(50) NOT NULL,
    "purchase_order_id" UUID,
    "location_id" UUID NOT NULL,
    "receipt_date" DATE NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "received_by_id" UUID NOT NULL,
    "qc_status" VARCHAR(30) DEFAULT 'NOT_REQUIRED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "goods_receipt_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "lot_number" VARCHAR(50),
    "expiry_date" DATE,
    "notes" TEXT,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "order_number" VARCHAR(50) NOT NULL,
    "product_id" UUID NOT NULL,
    "bom_id" UUID,
    "routing_id" UUID,
    "location_id" UUID NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "planned_qty" DECIMAL(18,4) NOT NULL,
    "completed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrapped_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "planned_start_date" DATE NOT NULL,
    "planned_end_date" DATE NOT NULL,
    "actual_start_date" TIMESTAMP(3),
    "actual_end_date" TIMESTAMP(3),
    "planned_order_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_operations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "work_order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "operation_code" VARCHAR(50) NOT NULL,
    "operation_name" VARCHAR(255) NOT NULL,
    "work_center_id" UUID NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "planned_setup_time" DECIMAL(10,2) NOT NULL,
    "planned_run_time" DECIMAL(10,2) NOT NULL,
    "actual_setup_time" DECIMAL(10,2),
    "actual_run_time" DECIMAL(10,2),
    "completed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrapped_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "work_order_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_issues" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "issue_number" VARCHAR(50) NOT NULL,
    "work_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "issue_date" DATE NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "lot_number" VARCHAR(50),
    "batch_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_completions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "completion_number" VARCHAR(50) NOT NULL,
    "work_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "completed_qty" DECIMAL(18,4) NOT NULL,
    "scrapped_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "completion_date" DATE NOT NULL,
    "completed_by_id" UUID NOT NULL,
    "lot_number" VARCHAR(50),
    "batch_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_entries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "hours_worked" DECIMAL(6,2),
    "labor_type" "LaborType" NOT NULL DEFAULT 'RUN',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "transaction_type" "InventoryTransactionType" NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "reference_number" VARCHAR(50),
    "lot_number" VARCHAR(50),
    "batch_id" UUID,
    "to_location_id" UUID,
    "unit_cost" DECIMAL(18,4),
    "total_cost" DECIMAL(18,4),
    "reason" VARCHAR(255),
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
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

-- CreateTable
CREATE TABLE "forecast_accuracy_metrics" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID,
    "period_date" DATE NOT NULL,
    "forecast_qty" DECIMAL(18,4) NOT NULL,
    "actual_qty" DECIMAL(18,4) NOT NULL,
    "mape" DECIMAL(10,4),
    "bias" DECIMAL(10,4),
    "tracking_signal" DECIMAL(10,4),
    "mad" DECIMAL(10,4),
    "forecast_model" VARCHAR(100),
    "forecast_version" VARCHAR(50),
    "granularity" VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_accuracy_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID,
    "purchase_order_id" UUID,
    "goods_receipt_id" UUID,
    "inspection_number" VARCHAR(50) NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID,
    "inspection_type" "QualityInspectionType" NOT NULL,
    "status" "QualityInspectionStatus" NOT NULL DEFAULT 'PENDING',
    "inspected_qty" DECIMAL(18,4) NOT NULL,
    "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejected_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defect_type" VARCHAR(100),
    "defect_description" TEXT,
    "inspector_id" UUID,
    "inspection_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_date" TIMESTAMP(3),
    "inspection_plan_id" UUID,
    "sample_size" INTEGER,
    "lot_size" INTEGER,
    "batch_id" UUID,
    "notes" TEXT,
    "results" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_of_measure_conversions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "from_uom" VARCHAR(20) NOT NULL,
    "to_uom" VARCHAR(20) NOT NULL,
    "product_id" UUID,
    "factor" DECIMAL(18,8) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_of_measure_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_hierarchies" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "parent_id" UUID,
    "level" INTEGER NOT NULL DEFAULT 0,
    "hierarchy_type" VARCHAR(50) NOT NULL DEFAULT 'OPERATIONAL',
    "path" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_hierarchies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capacity_plans" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "plan_type" "CapacityPlanType" NOT NULL DEFAULT 'RCCP',
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "planning_horizon" INTEGER NOT NULL DEFAULT 52,
    "granularity" VARCHAR(20) NOT NULL DEFAULT 'WEEKLY',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capacity_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capacity_plan_buckets" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "capacity_plan_id" UUID NOT NULL,
    "work_center_id" UUID NOT NULL,
    "period_date" DATE NOT NULL,
    "available_capacity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "required_capacity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "load_percent" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "overload_flag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "capacity_plan_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_gap_analyses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "product_id" UUID,
    "location_id" UUID,
    "period_date" DATE NOT NULL,
    "demand_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "supply_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gap_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gap_revenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gap_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "resolution" VARCHAR(500),
    "priority" VARCHAR(20),
    "assigned_to" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_gap_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_contracts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "contract_number" VARCHAR(50) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "contract_type" "PurchaseContractType" NOT NULL DEFAULT 'BLANKET',
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "total_value" DECIMAL(18,4),
    "consumed_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "payment_terms" VARCHAR(100),
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_contract_lines" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "contract_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "agreed_price" DECIMAL(18,4) NOT NULL,
    "agreed_qty" DECIMAL(18,4),
    "consumed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "min_order_qty" DECIMAL(18,4),
    "lead_time_days" INTEGER,
    "uom" VARCHAR(20),

    CONSTRAINT "purchase_contract_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_costings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID,
    "cost_type" "CostType" NOT NULL DEFAULT 'STANDARD',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "material_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "labor_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overhead_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "subcontract_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "version" VARCHAR(50),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_costings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "batch_number" VARCHAR(50) NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "available_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL DEFAULT 'EA',
    "status" "BatchStatus" NOT NULL DEFAULT 'CREATED',
    "manufacturing_date" DATE,
    "expiry_date" DATE,
    "supplier_id" UUID,
    "purchase_order_id" UUID,
    "work_order_id" UUID,
    "cost_per_unit" DECIMAL(18,4),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "reservation_number" VARCHAR(50) NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "batch_id" UUID,
    "reserved_qty" DECIMAL(18,4) NOT NULL,
    "fulfilled_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "reference_type" VARCHAR(50) NOT NULL,
    "reference_id" UUID NOT NULL,
    "reference_number" VARCHAR(50),
    "required_date" DATE,
    "reserved_by_id" UUID NOT NULL,
    "released_by_id" UUID,
    "released_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_holds" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "hold_number" VARCHAR(50) NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "batch_id" UUID,
    "held_qty" DECIMAL(18,4) NOT NULL,
    "released_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "hold_reason" VARCHAR(30) NOT NULL DEFAULT 'QC_PENDING',
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "inspection_id" UUID,
    "placed_by_id" UUID NOT NULL,
    "released_by_id" UUID,
    "released_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_costs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "material_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "labor_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overhead_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "subcontract_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrap_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cost_per_unit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "std_material_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "std_labor_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "std_overhead_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "std_total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "material_variance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "labor_variance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overhead_variance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_variance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "completed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "account_number" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "account_type" "GLAccountType" NOT NULL DEFAULT 'ASSET',
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "normal_balance" "NormalBalance" NOT NULL DEFAULT 'DEBIT',
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_profiles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "profile_name" VARCHAR(100) NOT NULL,
    "transaction_type" "PostingTransactionType" NOT NULL,
    "debit_account_id" UUID NOT NULL,
    "credit_account_id" UUID NOT NULL,
    "product_category" VARCHAR(100),
    "location_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "entry_number" VARCHAR(50) NOT NULL,
    "entry_date" DATE NOT NULL,
    "fiscal_period_id" UUID,
    "posting_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference_type" VARCHAR(50) NOT NULL,
    "reference_id" UUID,
    "reversal_of_id" UUID,
    "is_reversed" BOOLEAN NOT NULL DEFAULT false,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "total_debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "posted_by_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "journal_entry_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "debit_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "product_id" UUID,
    "location_id" UUID,
    "cost_center_id" UUID,
    "description" TEXT,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_ledger" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "sequence_number" BIGSERIAL NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "batch_id" UUID,
    "entry_type" "LedgerEntryType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "reference_number" VARCHAR(50),
    "lot_number" VARCHAR(100),
    "inventory_status" "InventoryStatus" NOT NULL DEFAULT 'INV_AVAILABLE',
    "running_balance" DECIMAL(18,4),
    "journal_entry_id" UUID,
    "created_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_plans" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "plan_number" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "product_id" UUID,
    "inspection_type" "QualityInspectionType" NOT NULL DEFAULT 'INCOMING',
    "sampling_procedure" "SamplingProcedure" NOT NULL DEFAULT 'FIXED',
    "sample_size" INTEGER,
    "sample_percentage" DECIMAL(5,2),
    "aql_level" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE,
    "effective_to" DATE,
    "description" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_plan_characteristics" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "inspection_plan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "characteristic_name" VARCHAR(255) NOT NULL,
    "characteristic_type" "CharacteristicType" NOT NULL DEFAULT 'QUANTITATIVE',
    "uom" VARCHAR(20),
    "lower_limit" DECIMAL(18,6),
    "upper_limit" DECIMAL(18,6),
    "target_value" DECIMAL(18,6),
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "method" VARCHAR(255),
    "equipment" VARCHAR(255),

    CONSTRAINT "inspection_plan_characteristics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_results" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "inspection_id" UUID NOT NULL,
    "characteristic_id" UUID NOT NULL,
    "measured_value" DECIMAL(18,6),
    "qualitative_result" VARCHAR(50),
    "is_within_spec" BOOLEAN NOT NULL DEFAULT true,
    "inspector_id" UUID,
    "measured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "inspection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_conformance_reports" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "ncr_number" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "ncr_type" "NCRType" NOT NULL DEFAULT 'NCR_PRODUCT',
    "severity" "NCRSeverity" NOT NULL DEFAULT 'NCR_MINOR',
    "status" "NCRStatus" NOT NULL DEFAULT 'NCR_OPEN',
    "source_type" VARCHAR(50),
    "source_id" UUID,
    "product_id" UUID,
    "location_id" UUID,
    "batch_id" UUID,
    "work_order_id" UUID,
    "inspection_id" UUID,
    "affected_qty" DECIMAL(18,4),
    "uom" VARCHAR(20),
    "disposition" "NCRDisposition",
    "disposition_qty" DECIMAL(18,4),
    "root_cause" TEXT,
    "containment_action" TEXT,
    "reported_by_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    "closed_by_id" UUID,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "closed_at" TIMESTAMP(3),
    "cost_impact" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_conformance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "capa_number" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "capa_type" "CAPAType" NOT NULL DEFAULT 'CORRECTIVE',
    "status" "CAPAStatus" NOT NULL DEFAULT 'CAPA_OPEN',
    "priority" "CAPAPriority" NOT NULL DEFAULT 'CAPA_MEDIUM',
    "ncr_id" UUID,
    "root_cause_analysis" TEXT,
    "proposed_action" TEXT NOT NULL,
    "actual_action" TEXT,
    "verification_method" TEXT,
    "verification_result" TEXT,
    "assigned_to_id" UUID,
    "verified_by_id" UUID,
    "due_date" DATE NOT NULL,
    "completed_date" DATE,
    "verified_date" DATE,
    "effectiveness_check" BOOLEAN NOT NULL DEFAULT false,
    "cost_of_action" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_change_orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "eco_number" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "change_type" "ECOChangeType" NOT NULL DEFAULT 'ECO_STANDARD',
    "status" "ECOStatus" NOT NULL DEFAULT 'ECO_DRAFT',
    "priority" "CAPAPriority" NOT NULL DEFAULT 'CAPA_MEDIUM',
    "reason" TEXT,
    "impact_assessment" TEXT,
    "implementation_plan" TEXT,
    "effective_date" DATE,
    "expiry_date" DATE,
    "requested_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "implemented_by_id" UUID,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "implemented_at" TIMESTAMP(3),
    "cost_estimate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actual_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eco_affected_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "eco_id" UUID NOT NULL,
    "item_type" "ECOItemType" NOT NULL,
    "item_id" UUID NOT NULL,
    "change_description" TEXT NOT NULL,
    "old_revision" VARCHAR(20),
    "new_revision" VARCHAR(20),
    "old_values" JSONB,
    "new_values" JSONB,
    "status" "ECOItemStatus" NOT NULL DEFAULT 'ECO_ITEM_PENDING',
    "implemented_at" TIMESTAMP(3),

    CONSTRAINT "eco_affected_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "scope" VARCHAR(50) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "result_id" UUID,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- CreateIndex
CREATE INDEX "reports_tenant_id_idx" ON "reports"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_mappings_domain_key" ON "domain_mappings"("domain");

-- CreateIndex
CREATE INDEX "domain_mappings_tenant_id_idx" ON "domain_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_tenant_id_idx" ON "password_reset_tokens"("tenant_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_idx" ON "products"("tenant_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_code_key" ON "products"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "locations_tenant_id_idx" ON "locations"("tenant_id");

-- CreateIndex
CREATE INDEX "locations_tenant_id_region_idx" ON "locations"("tenant_id", "region");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenant_id_code_key" ON "locations"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_segment_idx" ON "customers"("tenant_id", "segment");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_code_key" ON "customers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_idx" ON "accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_type_idx" ON "accounts"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "accounts_parent_id_idx" ON "accounts"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "cost_centers_tenant_id_idx" ON "cost_centers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_tenant_id_code_key" ON "cost_centers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "actuals_tenant_id_period_date_idx" ON "actuals"("tenant_id", "period_date");

-- CreateIndex
CREATE INDEX "actuals_tenant_id_actual_type_period_date_idx" ON "actuals"("tenant_id", "actual_type", "period_date");

-- CreateIndex
CREATE INDEX "actuals_tenant_id_product_id_period_date_idx" ON "actuals"("tenant_id", "product_id", "period_date");

-- CreateIndex
CREATE INDEX "actuals_tenant_id_location_id_period_date_idx" ON "actuals"("tenant_id", "location_id", "period_date");

-- CreateIndex
CREATE INDEX "actuals_tenant_id_customer_id_period_date_idx" ON "actuals"("tenant_id", "customer_id", "period_date");

-- CreateIndex
CREATE INDEX "actuals_tenant_id_account_id_period_date_idx" ON "actuals"("tenant_id", "account_id", "period_date");

-- CreateIndex
CREATE INDEX "actuals_import_id_idx" ON "actuals"("import_id");

-- CreateIndex
CREATE INDEX "plan_versions_tenant_id_idx" ON "plan_versions"("tenant_id");

-- CreateIndex
CREATE INDEX "plan_versions_tenant_id_status_idx" ON "plan_versions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "plan_versions_tenant_id_plan_type_idx" ON "plan_versions"("tenant_id", "plan_type");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_tenant_id_name_version_key" ON "plan_versions"("tenant_id", "name", "version");

-- CreateIndex
CREATE INDEX "scenarios_tenant_id_idx" ON "scenarios"("tenant_id");

-- CreateIndex
CREATE INDEX "scenarios_plan_version_id_idx" ON "scenarios"("plan_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_tenant_id_plan_version_id_name_key" ON "scenarios"("tenant_id", "plan_version_id", "name");

-- CreateIndex
CREATE INDEX "forecasts_tenant_id_plan_version_id_scenario_id_period_date_idx" ON "forecasts"("tenant_id", "plan_version_id", "scenario_id", "period_date");

-- CreateIndex
CREATE INDEX "forecasts_forecast_run_id_idx" ON "forecasts"("forecast_run_id");

-- CreateIndex
CREATE INDEX "forecasts_tenant_id_product_id_period_date_idx" ON "forecasts"("tenant_id", "product_id", "period_date");

-- CreateIndex
CREATE INDEX "forecasts_tenant_id_location_id_period_date_idx" ON "forecasts"("tenant_id", "location_id", "period_date");

-- CreateIndex
CREATE INDEX "forecasts_tenant_id_account_id_period_date_idx" ON "forecasts"("tenant_id", "account_id", "period_date");

-- CreateIndex
CREATE INDEX "assumptions_tenant_id_plan_version_id_idx" ON "assumptions"("tenant_id", "plan_version_id");

-- CreateIndex
CREATE INDEX "assumptions_tenant_id_scenario_id_idx" ON "assumptions"("tenant_id", "scenario_id");

-- CreateIndex
CREATE INDEX "data_imports_tenant_id_idx" ON "data_imports"("tenant_id");

-- CreateIndex
CREATE INDEX "data_imports_tenant_id_status_idx" ON "data_imports"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "mapping_templates_tenant_id_idx" ON "mapping_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_templates_tenant_id_name_key" ON "mapping_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "forecast_jobs_tenant_id_status_idx" ON "forecast_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "forecast_jobs_status_priority_idx" ON "forecast_jobs"("status", "priority");

-- CreateIndex
CREATE INDEX "forecast_jobs_forecast_run_id_idx" ON "forecast_jobs"("forecast_run_id");

-- CreateIndex
CREATE INDEX "forecast_runs_tenant_id_plan_version_id_scenario_id_idx" ON "forecast_runs"("tenant_id", "plan_version_id", "scenario_id");

-- CreateIndex
CREATE INDEX "forecast_runs_tenant_id_status_idx" ON "forecast_runs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "forecast_runs_tenant_id_start_period_end_period_idx" ON "forecast_runs"("tenant_id", "start_period", "end_period");

-- CreateIndex
CREATE INDEX "forecast_results_tenant_id_period_date_idx" ON "forecast_results"("tenant_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_results_tenant_id_forecast_run_id_period_date_idx" ON "forecast_results"("tenant_id", "forecast_run_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_results_tenant_id_product_id_period_date_idx" ON "forecast_results"("tenant_id", "product_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_results_tenant_id_location_id_period_date_idx" ON "forecast_results"("tenant_id", "location_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_results_tenant_id_account_id_period_date_idx" ON "forecast_results"("tenant_id", "account_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_overrides_tenant_id_forecast_run_id_period_date_idx" ON "forecast_overrides"("tenant_id", "forecast_run_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_overrides_tenant_id_status_idx" ON "forecast_overrides"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "forecast_reconciliations_tenant_id_forecast_run_id_period_d_idx" ON "forecast_reconciliations"("tenant_id", "forecast_run_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_reconciliations_tenant_id_status_idx" ON "forecast_reconciliations"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_reconciliations_forecast_run_id_period_date_produc_key" ON "forecast_reconciliations"("forecast_run_id", "period_date", "product_id", "location_id", "customer_id", "account_id", "cost_center_id");

-- CreateIndex
CREATE INDEX "time_buckets_tenant_id_bucket_start_bucket_end_idx" ON "time_buckets"("tenant_id", "bucket_start", "bucket_end");

-- CreateIndex
CREATE UNIQUE INDEX "time_buckets_tenant_id_period_key_period_type_key" ON "time_buckets"("tenant_id", "period_key", "period_type");

-- CreateIndex
CREATE INDEX "fx_rates_tenant_id_from_currency_to_currency_as_of_date_idx" ON "fx_rates"("tenant_id", "from_currency", "to_currency", "as_of_date");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_tenant_id_from_currency_to_currency_as_of_date_key" ON "fx_rates"("tenant_id", "from_currency", "to_currency", "as_of_date");

-- CreateIndex
CREATE INDEX "fiscal_calendars_tenant_id_idx" ON "fiscal_calendars"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_calendars_tenant_id_name_key" ON "fiscal_calendars"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "fiscal_periods_calendar_id_idx" ON "fiscal_periods"("calendar_id");

-- CreateIndex
CREATE INDEX "fiscal_periods_start_date_end_date_idx" ON "fiscal_periods"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_calendar_id_fiscal_year_fiscal_month_key" ON "fiscal_periods"("calendar_id", "fiscal_year", "fiscal_month");

-- CreateIndex
CREATE INDEX "product_hierarchies_tenant_id_idx" ON "product_hierarchies"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_hierarchies_tenant_id_name_key" ON "product_hierarchies"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "product_hierarchy_nodes_hierarchy_id_idx" ON "product_hierarchy_nodes"("hierarchy_id");

-- CreateIndex
CREATE INDEX "product_hierarchy_nodes_parent_id_idx" ON "product_hierarchy_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "product_hierarchy_nodes_path_idx" ON "product_hierarchy_nodes"("path");

-- CreateIndex
CREATE UNIQUE INDEX "product_hierarchy_nodes_hierarchy_id_code_key" ON "product_hierarchy_nodes"("hierarchy_id", "code");

-- CreateIndex
CREATE INDEX "bills_of_material_tenant_id_idx" ON "bills_of_material"("tenant_id");

-- CreateIndex
CREATE INDEX "bills_of_material_parent_product_id_idx" ON "bills_of_material"("parent_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_of_material_tenant_id_parent_product_id_version_key" ON "bills_of_material"("tenant_id", "parent_product_id", "version");

-- CreateIndex
CREATE INDEX "bom_components_bom_id_idx" ON "bom_components"("bom_id");

-- CreateIndex
CREATE INDEX "bom_components_component_product_id_idx" ON "bom_components"("component_product_id");

-- CreateIndex
CREATE INDEX "work_centers_tenant_id_idx" ON "work_centers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_centers_tenant_id_code_key" ON "work_centers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "work_center_capacities_work_center_id_idx" ON "work_center_capacities"("work_center_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_center_shifts_work_center_id_shift_name_key" ON "work_center_shifts"("work_center_id", "shift_name");

-- CreateIndex
CREATE INDEX "routings_tenant_id_idx" ON "routings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "routings_bom_id_version_key" ON "routings"("bom_id", "version");

-- CreateIndex
CREATE INDEX "routing_operations_routing_id_idx" ON "routing_operations"("routing_id");

-- CreateIndex
CREATE UNIQUE INDEX "routing_operations_routing_id_sequence_key" ON "routing_operations"("routing_id", "sequence");

-- CreateIndex
CREATE INDEX "inventory_policies_tenant_id_idx" ON "inventory_policies"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_policies_product_id_idx" ON "inventory_policies"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_policies_tenant_id_product_id_location_id_key" ON "inventory_policies"("tenant_id", "product_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_levels_tenant_id_idx" ON "inventory_levels"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_levels_product_id_idx" ON "inventory_levels"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_tenant_id_product_id_location_id_key" ON "inventory_levels"("tenant_id", "product_id", "location_id");

-- CreateIndex
CREATE INDEX "mrp_runs_tenant_id_idx" ON "mrp_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "mrp_requirements_mrp_run_id_idx" ON "mrp_requirements"("mrp_run_id");

-- CreateIndex
CREATE INDEX "mrp_requirements_product_id_idx" ON "mrp_requirements"("product_id");

-- CreateIndex
CREATE INDEX "planned_orders_tenant_id_idx" ON "planned_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "planned_orders_product_id_idx" ON "planned_orders"("product_id");

-- CreateIndex
CREATE INDEX "planned_orders_status_idx" ON "planned_orders"("status");

-- CreateIndex
CREATE INDEX "mrp_exceptions_mrp_run_id_idx" ON "mrp_exceptions"("mrp_run_id");

-- CreateIndex
CREATE INDEX "mrp_exceptions_status_idx" ON "mrp_exceptions"("status");

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "supplier_products_product_id_idx" ON "supplier_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_products_supplier_id_product_id_key" ON "supplier_products"("supplier_id", "product_id");

-- CreateIndex
CREATE INDEX "workflow_templates_tenant_id_idx" ON "workflow_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_tenant_id_name_key" ON "workflow_templates"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_template_id_sequence_key" ON "workflow_steps"("template_id", "sequence");

-- CreateIndex
CREATE INDEX "workflow_instances_tenant_id_idx" ON "workflow_instances"("tenant_id");

-- CreateIndex
CREATE INDEX "workflow_instances_entity_type_entity_id_idx" ON "workflow_instances"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "workflow_actions_instance_id_idx" ON "workflow_actions"("instance_id");

-- CreateIndex
CREATE INDEX "promotions_tenant_id_idx" ON "promotions"("tenant_id");

-- CreateIndex
CREATE INDEX "promotions_start_date_end_date_idx" ON "promotions"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_tenant_id_code_key" ON "promotions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "promotion_lift_factors_promotion_id_idx" ON "promotion_lift_factors"("promotion_id");

-- CreateIndex
CREATE INDEX "sop_cycles_tenant_id_idx" ON "sop_cycles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sop_cycles_tenant_id_fiscal_year_fiscal_period_key" ON "sop_cycles"("tenant_id", "fiscal_year", "fiscal_period");

-- CreateIndex
CREATE UNIQUE INDEX "sop_forecasts_cycle_id_source_key" ON "sop_forecasts"("cycle_id", "source");

-- CreateIndex
CREATE INDEX "sop_assumptions_cycle_id_idx" ON "sop_assumptions"("cycle_id");

-- CreateIndex
CREATE INDEX "new_product_introductions_tenant_id_idx" ON "new_product_introductions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "new_product_introductions_tenant_id_product_id_key" ON "new_product_introductions"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "external_data_sources_tenant_id_idx" ON "external_data_sources"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_data_sources_tenant_id_name_key" ON "external_data_sources"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "external_data_points_source_id_data_date_idx" ON "external_data_points"("source_id", "data_date");

-- CreateIndex
CREATE INDEX "external_data_points_product_id_idx" ON "external_data_points"("product_id");

-- CreateIndex
CREATE INDEX "financial_plans_tenant_id_idx" ON "financial_plans"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_plans_tenant_id_plan_version_id_type_key" ON "financial_plans"("tenant_id", "plan_version_id", "type");

-- CreateIndex
CREATE INDEX "financial_plan_lines_financial_plan_id_idx" ON "financial_plan_lines"("financial_plan_id");

-- CreateIndex
CREATE INDEX "financial_plan_lines_account_id_idx" ON "financial_plan_lines"("account_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_idx" ON "purchase_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_order_number_key" ON "purchase_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_product_id_idx" ON "purchase_order_lines"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_number_key" ON "purchase_order_lines"("purchase_order_id", "line_number");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_idx" ON "goods_receipts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_receipt_number_key" ON "goods_receipts"("tenant_id", "receipt_number");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_product_id_idx" ON "goods_receipt_lines"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_lines_goods_receipt_id_line_number_key" ON "goods_receipt_lines"("goods_receipt_id", "line_number");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_idx" ON "work_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "work_orders_product_id_idx" ON "work_orders"("product_id");

-- CreateIndex
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenant_id_order_number_key" ON "work_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "work_order_operations_work_center_id_idx" ON "work_order_operations"("work_center_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_operations_work_order_id_sequence_key" ON "work_order_operations"("work_order_id", "sequence");

-- CreateIndex
CREATE INDEX "material_issues_tenant_id_idx" ON "material_issues"("tenant_id");

-- CreateIndex
CREATE INDEX "material_issues_work_order_id_idx" ON "material_issues"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_issues_tenant_id_issue_number_key" ON "material_issues"("tenant_id", "issue_number");

-- CreateIndex
CREATE INDEX "production_completions_tenant_id_idx" ON "production_completions"("tenant_id");

-- CreateIndex
CREATE INDEX "production_completions_work_order_id_idx" ON "production_completions"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_completions_tenant_id_completion_number_key" ON "production_completions"("tenant_id", "completion_number");

-- CreateIndex
CREATE INDEX "labor_entries_tenant_id_idx" ON "labor_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "labor_entries_operation_id_idx" ON "labor_entries"("operation_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_tenant_id_idx" ON "inventory_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_product_id_idx" ON "inventory_transactions"("product_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_transaction_type_idx" ON "inventory_transactions"("transaction_type");

-- CreateIndex
CREATE INDEX "inventory_transactions_transaction_date_idx" ON "inventory_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_is_read_idx" ON "notifications"("tenant_id", "user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_type_idx" ON "notifications"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "forecast_accuracy_metrics_tenant_id_period_date_idx" ON "forecast_accuracy_metrics"("tenant_id", "period_date");

-- CreateIndex
CREATE INDEX "forecast_accuracy_metrics_tenant_id_product_id_idx" ON "forecast_accuracy_metrics"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_accuracy_metrics_tenant_id_product_id_location_id__key" ON "forecast_accuracy_metrics"("tenant_id", "product_id", "location_id", "period_date", "granularity");

-- CreateIndex
CREATE INDEX "quality_inspections_tenant_id_status_idx" ON "quality_inspections"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "quality_inspections_tenant_id_work_order_id_idx" ON "quality_inspections"("tenant_id", "work_order_id");

-- CreateIndex
CREATE INDEX "quality_inspections_tenant_id_purchase_order_id_idx" ON "quality_inspections"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "unit_of_measure_conversions_tenant_id_idx" ON "unit_of_measure_conversions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measure_conversions_tenant_id_from_uom_to_uom_produ_key" ON "unit_of_measure_conversions"("tenant_id", "from_uom", "to_uom", "product_id");

-- CreateIndex
CREATE INDEX "location_hierarchies_tenant_id_parent_id_idx" ON "location_hierarchies"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "location_hierarchies_tenant_id_location_id_hierarchy_type_key" ON "location_hierarchies"("tenant_id", "location_id", "hierarchy_type");

-- CreateIndex
CREATE INDEX "capacity_plans_tenant_id_status_idx" ON "capacity_plans"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "capacity_plan_buckets_capacity_plan_id_idx" ON "capacity_plan_buckets"("capacity_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "capacity_plan_buckets_capacity_plan_id_work_center_id_perio_key" ON "capacity_plan_buckets"("capacity_plan_id", "work_center_id", "period_date");

-- CreateIndex
CREATE INDEX "sop_gap_analyses_tenant_id_cycle_id_idx" ON "sop_gap_analyses"("tenant_id", "cycle_id");

-- CreateIndex
CREATE INDEX "sop_gap_analyses_tenant_id_status_idx" ON "sop_gap_analyses"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_contracts_tenant_id_supplier_id_idx" ON "purchase_contracts"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "purchase_contracts_tenant_id_status_idx" ON "purchase_contracts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_contracts_tenant_id_contract_number_key" ON "purchase_contracts"("tenant_id", "contract_number");

-- CreateIndex
CREATE INDEX "purchase_contract_lines_contract_id_idx" ON "purchase_contract_lines"("contract_id");

-- CreateIndex
CREATE INDEX "product_costings_tenant_id_product_id_idx" ON "product_costings"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "product_costings_tenant_id_effective_from_idx" ON "product_costings"("tenant_id", "effective_from");

-- CreateIndex
CREATE INDEX "batches_tenant_id_idx" ON "batches"("tenant_id");

-- CreateIndex
CREATE INDEX "batches_product_id_idx" ON "batches"("product_id");

-- CreateIndex
CREATE INDEX "batches_status_idx" ON "batches"("status");

-- CreateIndex
CREATE INDEX "batches_expiry_date_idx" ON "batches"("expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "batches_tenant_id_batch_number_key" ON "batches"("tenant_id", "batch_number");

-- CreateIndex
CREATE INDEX "inventory_reservations_tenant_id_idx" ON "inventory_reservations"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_product_id_location_id_idx" ON "inventory_reservations"("product_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_reference_type_reference_id_idx" ON "inventory_reservations"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_idx" ON "inventory_reservations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_tenant_id_reservation_number_key" ON "inventory_reservations"("tenant_id", "reservation_number");

-- CreateIndex
CREATE INDEX "inventory_holds_tenant_id_idx" ON "inventory_holds"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_holds_product_id_location_id_idx" ON "inventory_holds"("product_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_holds_status_idx" ON "inventory_holds"("status");

-- CreateIndex
CREATE INDEX "inventory_holds_inspection_id_idx" ON "inventory_holds"("inspection_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_holds_tenant_id_hold_number_key" ON "inventory_holds"("tenant_id", "hold_number");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_costs_work_order_id_key" ON "work_order_costs"("work_order_id");

-- CreateIndex
CREATE INDEX "work_order_costs_tenant_id_idx" ON "work_order_costs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_costs_tenant_id_work_order_id_key" ON "work_order_costs"("tenant_id", "work_order_id");

-- CreateIndex
CREATE INDEX "gl_accounts_tenant_id_idx" ON "gl_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "gl_accounts_tenant_id_account_type_idx" ON "gl_accounts"("tenant_id", "account_type");

-- CreateIndex
CREATE INDEX "gl_accounts_parent_id_idx" ON "gl_accounts"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_accounts_tenant_id_account_number_key" ON "gl_accounts"("tenant_id", "account_number");

-- CreateIndex
CREATE INDEX "posting_profiles_tenant_id_idx" ON "posting_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "posting_profiles_tenant_id_transaction_type_idx" ON "posting_profiles"("tenant_id", "transaction_type");

-- CreateIndex
CREATE UNIQUE INDEX "posting_profiles_tenant_id_profile_name_key" ON "posting_profiles"("tenant_id", "profile_name");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_idx" ON "journal_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "journal_entries_fiscal_period_id_idx" ON "journal_entries"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "journal_entries_reference_type_reference_id_idx" ON "journal_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_entry_date_idx" ON "journal_entries"("tenant_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenant_id_entry_number_key" ON "journal_entries"("tenant_id", "entry_number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenant_id_idempotency_key_key" ON "journal_entries"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "journal_entry_lines_journal_entry_id_idx" ON "journal_entry_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_gl_account_id_idx" ON "journal_entry_lines"("gl_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_lines_journal_entry_id_line_number_key" ON "journal_entry_lines"("journal_entry_id", "line_number");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenant_id_idx" ON "inventory_ledger"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_ledger_product_id_location_id_idx" ON "inventory_ledger"("product_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_ledger_batch_id_idx" ON "inventory_ledger"("batch_id");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenant_id_transaction_date_idx" ON "inventory_ledger"("tenant_id", "transaction_date");

-- CreateIndex
CREATE INDEX "inventory_ledger_reference_type_reference_id_idx" ON "inventory_ledger"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "inventory_ledger_sequence_number_idx" ON "inventory_ledger"("sequence_number");

-- CreateIndex
CREATE INDEX "inventory_ledger_inventory_status_idx" ON "inventory_ledger"("inventory_status");

-- CreateIndex
CREATE INDEX "inspection_plans_tenant_id_idx" ON "inspection_plans"("tenant_id");

-- CreateIndex
CREATE INDEX "inspection_plans_product_id_idx" ON "inspection_plans"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_plans_tenant_id_plan_number_key" ON "inspection_plans"("tenant_id", "plan_number");

-- CreateIndex
CREATE INDEX "inspection_plan_characteristics_inspection_plan_id_idx" ON "inspection_plan_characteristics"("inspection_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_plan_characteristics_inspection_plan_id_sequence_key" ON "inspection_plan_characteristics"("inspection_plan_id", "sequence");

-- CreateIndex
CREATE INDEX "inspection_results_inspection_id_idx" ON "inspection_results"("inspection_id");

-- CreateIndex
CREATE INDEX "non_conformance_reports_tenant_id_idx" ON "non_conformance_reports"("tenant_id");

-- CreateIndex
CREATE INDEX "non_conformance_reports_tenant_id_status_idx" ON "non_conformance_reports"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "non_conformance_reports_product_id_idx" ON "non_conformance_reports"("product_id");

-- CreateIndex
CREATE INDEX "non_conformance_reports_inspection_id_idx" ON "non_conformance_reports"("inspection_id");

-- CreateIndex
CREATE UNIQUE INDEX "non_conformance_reports_tenant_id_ncr_number_key" ON "non_conformance_reports"("tenant_id", "ncr_number");

-- CreateIndex
CREATE INDEX "corrective_actions_tenant_id_idx" ON "corrective_actions"("tenant_id");

-- CreateIndex
CREATE INDEX "corrective_actions_tenant_id_status_idx" ON "corrective_actions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "corrective_actions_ncr_id_idx" ON "corrective_actions"("ncr_id");

-- CreateIndex
CREATE UNIQUE INDEX "corrective_actions_tenant_id_capa_number_key" ON "corrective_actions"("tenant_id", "capa_number");

-- CreateIndex
CREATE INDEX "engineering_change_orders_tenant_id_idx" ON "engineering_change_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "engineering_change_orders_tenant_id_status_idx" ON "engineering_change_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "engineering_change_orders_effective_date_idx" ON "engineering_change_orders"("effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_change_orders_tenant_id_eco_number_key" ON "engineering_change_orders"("tenant_id", "eco_number");

-- CreateIndex
CREATE INDEX "eco_affected_items_eco_id_idx" ON "eco_affected_items"("eco_id");

-- CreateIndex
CREATE INDEX "eco_affected_items_item_type_item_id_idx" ON "eco_affected_items"("item_type", "item_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_tenant_id_idx" ON "idempotency_keys"("tenant_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenant_scope_key_unique" ON "idempotency_keys"("tenant_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "data_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_forecast_run_id_fkey" FOREIGN KEY ("forecast_run_id") REFERENCES "forecast_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_mapping_template_id_fkey" FOREIGN KEY ("mapping_template_id") REFERENCES "mapping_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_results" ADD CONSTRAINT "forecast_results_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_results" ADD CONSTRAINT "forecast_results_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_results" ADD CONSTRAINT "forecast_results_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_results" ADD CONSTRAINT "forecast_results_forecast_run_id_fkey" FOREIGN KEY ("forecast_run_id") REFERENCES "forecast_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_results" ADD CONSTRAINT "forecast_results_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_results" ADD CONSTRAINT "forecast_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_forecast_run_id_fkey" FOREIGN KEY ("forecast_run_id") REFERENCES "forecast_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_actual_id_fkey" FOREIGN KEY ("actual_id") REFERENCES "actuals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_forecast_run_id_fkey" FOREIGN KEY ("forecast_run_id") REFERENCES "forecast_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_reconciliations" ADD CONSTRAINT "forecast_reconciliations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_buckets" ADD CONSTRAINT "time_buckets_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "fiscal_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "fiscal_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_hierarchy_nodes" ADD CONSTRAINT "product_hierarchy_nodes_hierarchy_id_fkey" FOREIGN KEY ("hierarchy_id") REFERENCES "product_hierarchies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_hierarchy_nodes" ADD CONSTRAINT "product_hierarchy_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_hierarchy_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_material" ADD CONSTRAINT "bills_of_material_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "bills_of_material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "routing_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_center_capacities" ADD CONSTRAINT "work_center_capacities_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_center_shifts" ADD CONSTRAINT "work_center_shifts_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routings" ADD CONSTRAINT "routings_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "bills_of_material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "routings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_policies" ADD CONSTRAINT "inventory_policies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_policies" ADD CONSTRAINT "inventory_policies_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_requirements" ADD CONSTRAINT "mrp_requirements_mrp_run_id_fkey" FOREIGN KEY ("mrp_run_id") REFERENCES "mrp_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_requirements" ADD CONSTRAINT "mrp_requirements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_mrp_run_id_fkey" FOREIGN KEY ("mrp_run_id") REFERENCES "mrp_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_orders" ADD CONSTRAINT "planned_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_exceptions" ADD CONSTRAINT "mrp_exceptions_mrp_run_id_fkey" FOREIGN KEY ("mrp_run_id") REFERENCES "mrp_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_lift_factors" ADD CONSTRAINT "promotion_lift_factors_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_forecasts" ADD CONSTRAINT "sop_forecasts_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "sop_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_assumptions" ADD CONSTRAINT "sop_assumptions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "sop_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "new_product_introductions" ADD CONSTRAINT "new_product_introductions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_data_points" ADD CONSTRAINT "external_data_points_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "external_data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan_lines" ADD CONSTRAINT "financial_plan_lines_financial_plan_id_fkey" FOREIGN KEY ("financial_plan_id") REFERENCES "financial_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "bills_of_material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "routings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "work_order_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_accuracy_metrics" ADD CONSTRAINT "forecast_accuracy_metrics_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_accuracy_metrics" ADD CONSTRAINT "forecast_accuracy_metrics_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_inspection_plan_id_fkey" FOREIGN KEY ("inspection_plan_id") REFERENCES "inspection_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_of_measure_conversions" ADD CONSTRAINT "unit_of_measure_conversions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_hierarchies" ADD CONSTRAINT "location_hierarchies_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_hierarchies" ADD CONSTRAINT "location_hierarchies_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "location_hierarchies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capacity_plan_buckets" ADD CONSTRAINT "capacity_plan_buckets_capacity_plan_id_fkey" FOREIGN KEY ("capacity_plan_id") REFERENCES "capacity_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capacity_plan_buckets" ADD CONSTRAINT "capacity_plan_buckets_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_gap_analyses" ADD CONSTRAINT "sop_gap_analyses_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "sop_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_gap_analyses" ADD CONSTRAINT "sop_gap_analyses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_contracts" ADD CONSTRAINT "purchase_contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_contract_lines" ADD CONSTRAINT "purchase_contract_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "purchase_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_contract_lines" ADD CONSTRAINT "purchase_contract_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costings" ADD CONSTRAINT "product_costings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costings" ADD CONSTRAINT "product_costings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_reserved_by_id_fkey" FOREIGN KEY ("reserved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_placed_by_id_fkey" FOREIGN KEY ("placed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_costs" ADD CONSTRAINT "work_order_costs_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profiles" ADD CONSTRAINT "posting_profiles_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profiles" ADD CONSTRAINT "posting_profiles_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profiles" ADD CONSTRAINT "posting_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_plan_characteristics" ADD CONSTRAINT "inspection_plan_characteristics_inspection_plan_id_fkey" FOREIGN KEY ("inspection_plan_id") REFERENCES "inspection_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_characteristic_id_fkey" FOREIGN KEY ("characteristic_id") REFERENCES "inspection_plan_characteristics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_ncr_id_fkey" FOREIGN KEY ("ncr_id") REFERENCES "non_conformance_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_change_orders" ADD CONSTRAINT "engineering_change_orders_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_change_orders" ADD CONSTRAINT "engineering_change_orders_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_change_orders" ADD CONSTRAINT "engineering_change_orders_implemented_by_id_fkey" FOREIGN KEY ("implemented_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eco_affected_items" ADD CONSTRAINT "eco_affected_items_eco_id_fkey" FOREIGN KEY ("eco_id") REFERENCES "engineering_change_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
