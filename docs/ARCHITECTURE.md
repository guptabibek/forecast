# System Architecture

## 1. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              LOAD BALANCER (AWS ALB / Nginx)                     │
│                         ┌─────────────────────────────────┐                      │
│                         │  tenant1.forecasthub.com        │                      │
│                         │  tenant2.forecasthub.com        │                      │
│                         │  custom.company.com             │                      │
│                         └─────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│    FRONTEND (React)     │  │    FRONTEND (React)     │  │    FRONTEND (React)     │
│    CDN / S3 Static      │  │    CDN / S3 Static      │  │    CDN / S3 Static      │
│                         │  │                         │  │                         │
│ • Dashboard             │  │ • Dashboard             │  │ • Dashboard             │
│ • Plan Management       │  │ • Plan Management       │  │ • Plan Management       │
│ • Forecast Viz          │  │ • Forecast Viz          │  │ • Forecast Viz          │
│ • Data Upload           │  │ • Data Upload           │  │ • Data Upload           │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY (Kong / AWS API GW)                     │
│                         • Rate Limiting                                          │
│                         • JWT Validation                                         │
│                         • Tenant Routing                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND SERVICES (NestJS)                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  Auth Module    │  │  Actuals Module │  │  Plans Module   │                  │
│  │  • JWT Auth     │  │  • CSV Upload   │  │  • Versioning   │                  │
│  │  • RBAC         │  │  • Excel Upload │  │  • Lock/Approve │                  │
│  │  • SSO/SAML     │  │  • API Ingest   │  │  • Workflow     │                  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Forecast Module │  │ Scenarios Module│  │  Audit Module   │                  │
│  │ • Model Select  │  │ • Create/Clone  │  │  • Change Log   │                  │
│  │ • Generate      │  │ • Compare       │  │  • History      │                  │
│  │ • Override      │  │ • Analytics     │  │  • Compliance   │                  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    │                              │
          ┌─────────┴─────────┐          ┌────────┴────────┐
          ▼                   ▼          ▼                 ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────────┐
│  FORECAST       │  │  JOB QUEUE      │  │  DATABASE LAYER                     │
│  ENGINE         │  │  (BullMQ/Redis) │  │                                     │
│                 │  │                 │  │  ┌─────────────────────────────────┐│
│ ┌─────────────┐ │  │ • Forecast Jobs │  │  │  PostgreSQL (Primary)           ││
│ │Moving Avg   │ │  │ • Import Jobs   │  │  │  • Multi-tenant schemas         ││
│ ├─────────────┤ │  │ • Export Jobs   │  │  │  • Row-Level Security           ││
│ │Weighted Avg │ │  │ • Notification  │  │  │  • Partitioned tables           ││
│ ├─────────────┤ │  │                 │  │  └─────────────────────────────────┘│
│ │Linear Reg   │ │  └─────────────────┘  │  ┌─────────────────────────────────┐│
│ ├─────────────┤ │                       │  │  Redis (Cache)                  ││
│ │Holt-Winters │ │                       │  │  • Session cache                ││
│ ├─────────────┤ │                       │  │  • Forecast cache               ││
│ │YoY Growth   │ │                       │  │  • Rate limiting                ││
│ ├─────────────┤ │                       │  └─────────────────────────────────┘│
│ │AI Hybrid    │ │                       │                                     │
│ └─────────────┘ │                       └─────────────────────────────────────┘
└─────────────────┘
         │
         ▼ (Optional)
┌─────────────────┐
│  PYTHON ML      │
│  MICROSERVICE   │
│  (FastAPI)      │
│  • Prophet      │
│  • ARIMA        │
│  • XGBoost      │
└─────────────────┘
```

## 2. Multi-Tenant Isolation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MULTI-TENANT ISOLATION                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

Request Flow:
─────────────
1. User accesses: https://acme.forecasthub.com
2. DNS resolves to Load Balancer
3. Load Balancer forwards to API Gateway

┌──────────────────────────────────────────────────────────────────┐
│  API GATEWAY - Tenant Resolution                                  │
│                                                                   │
│  1. Extract domain: acme.forecasthub.com                         │
│  2. Lookup tenant_id from domain_mappings table                  │
│  3. Validate JWT contains matching tenant_id                     │
│  4. Inject X-Tenant-ID header into request                       │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  NESTJS MIDDLEWARE - TenantContext                               │
│                                                                   │
│  @Injectable()                                                   │
│  export class TenantMiddleware {                                 │
│    use(req, res, next) {                                         │
│      const tenantId = req.headers['x-tenant-id'];                │
│      TenantContext.setCurrentTenant(tenantId);                   │
│      next();                                                     │
│    }                                                             │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  PRISMA - Automatic Tenant Filtering                             │
│                                                                   │
│  prisma.$use((params, next) => {                                │
│    if (modelHasTenantId(params.model) && currentTenant()) {     │
│      params.args.where = { ...params.args.where, tenantId };    │
│      params.args.data = { ...params.args.data, tenantId };      │
│      if (params.action === 'findUnique') {                      │
│        params.action = 'findFirst';                             │
│      }                                                           │
│    }                                                             │
│    return next(params);                                          │
│  });                                                             │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  POSTGRESQL - Row-Level Security (Next Layer)                    │
│                                                                   │
│  Status: Planned for staged rollout on tenant-scoped tables      │
│  Current enforcement: application + Prisma middleware            │
└──────────────────────────────────────────────────────────────────┘

Data Isolation Guarantees:
─────────────────────────
✓ Every table has tenant_id as required field
✓ All foreign keys include tenant_id in composite keys
✓ Application-level middleware enforces tenant context
✓ Prisma middleware enforces tenant filters on tenant-scoped models
◻ Database-level RLS staged rollout is pending
✓ Audit logs track all cross-tenant access attempts
✓ API responses never leak tenant_id to other tenants
```

## 3. Data Ingestion Workflow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DATA INGESTION WORKFLOW                                │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │         DATA SOURCES            │
                    │  ┌─────┐ ┌─────┐ ┌───────────┐ │
                    │  │ CSV │ │Excel│ │  API/ERP  │ │
                    │  └──┬──┘ └──┬──┘ └─────┬─────┘ │
                    └─────┼───────┼──────────┼───────┘
                          │       │          │
                          └───────┼──────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: FILE UPLOAD / API RECEIVE                                              │
│  ─────────────────────────────────                                              │
│  • Files uploaded to S3 temp bucket                                             │
│  • API payloads validated against OpenAPI schema                                │
│  • Create ingestion_job record with status: PENDING                             │
│  • Return job_id to client for polling                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: JOB QUEUE PROCESSING (BullMQ)                                          │
│  ─────────────────────────────────────                                          │
│  • Worker picks up job from queue                                               │
│  • Parse file (CSV/Excel) or validate API payload                               │
│  • Detect columns and data types                                                │
│  • Update job status: PROCESSING                                                │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: SCHEMA MAPPING                                                         │
│  ──────────────────────                                                         │
│                                                                                 │
│  Source Columns              Canonical Schema                                   │
│  ─────────────────           ─────────────────                                  │
│  "Product Code"    ────►     product_id                                         │
│  "Sales Qty"       ────►     quantity                                           │
│  "Revenue USD"     ────►     amount                                             │
│  "Trans Date"      ────►     period_date                                        │
│  "Store ID"        ────►     location_id                                        │
│                                                                                 │
│  • User creates/selects mapping template                                        │
│  • Mappings saved per tenant for reuse                                          │
│  • Support for transformations (date format, currency)                          │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: VALIDATION                                                             │
│  ──────────────────                                                             │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐           │
│  │  Validation Rules:                                               │           │
│  │  ✓ Required fields present                                       │           │
│  │  ✓ Data types match (numeric, date, string)                      │           │
│  │  ✓ Foreign keys exist (product_id, location_id)                  │           │
│  │  ✓ No duplicate records                                          │           │
│  │  ✓ Values within acceptable ranges                               │           │
│  │  ✓ Period dates within allowed range                             │           │
│  └─────────────────────────────────────────────────────────────────┘           │
│                                                                                 │
│  Validation Result:                                                             │
│  {                                                                              │
│    "total_rows": 10000,                                                         │
│    "valid_rows": 9850,                                                          │
│    "error_rows": 150,                                                           │
│    "errors": [                                                                  │
│      { "row": 42, "field": "amount", "error": "Invalid numeric value" },       │
│      { "row": 156, "field": "product_id", "error": "Product not found" }       │
│    ]                                                                            │
│  }                                                                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: NORMALIZATION & STORAGE                                                │
│  ───────────────────────────────                                                │
│                                                                                 │
│  • Convert to canonical format                                                  │
│  • Apply currency conversion if needed                                          │
│  • Aggregate to configured time granularity                                     │
│  • Batch insert into actuals table                                              │
│  • Update job status: COMPLETED                                                 │
│  • Send notification to user                                                    │
│                                                                                 │
│  INSERT INTO actuals (                                                          │
│    tenant_id, actual_type, product_id, location_id,                            │
│    customer_id, period_date, quantity, amount, currency,                        │
│    source_system, created_at                                                    │
│  ) VALUES ...                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: POST-PROCESSING                                                        │
│  ───────────────────────                                                        │
│                                                                                 │
│  • Calculate derived metrics (margins, growth rates)                            │
│  • Update aggregation tables (monthly, quarterly, yearly)                       │
│  • Refresh materialized views for dashboards                                    │
│  • Trigger cache invalidation                                                   │
│  • Log audit trail                                                              │
└─────────────────────────────────────────────────────────────────────────────────┘

Error Handling:
───────────────
• Partial success: Valid rows inserted, errors reported
• User can download error report with row numbers
• User can fix and re-upload only error rows
• All operations are idempotent (re-upload same data = update, not duplicate)
```

## 4. Forecast Generation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         FORECAST GENERATION FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  USER REQUEST                                                             │
│  ────────────                                                             │
│  {                                                                        │
│    "plan_version_id": "uuid",                                            │
│    "scenario_id": "uuid",                                                │
│    "forecast_model": "HOLT_WINTERS",                                     │
│    "dimensions": ["product_id", "location_id"],                          │
│    "periods": { "start": "2026-01", "end": "2026-12" },                  │
│    "assumptions": {                                                       │
│      "seasonality_period": 12,                                           │
│      "trend_damping": 0.95                                               │
│    }                                                                      │
│  }                                                                        │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 1: QUEUE FORECAST JOB                                              │
│  ─────────────────────────────                                           │
│  • Create forecast_job record                                            │
│  • Add to BullMQ forecast queue                                          │
│  • Return job_id for status polling                                      │
│  • Job priority based on tenant tier                                     │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 2: LOAD HISTORICAL ACTUALS                                         │
│  ───────────────────────────────                                         │
│                                                                          │
│  SELECT                                                                  │
│    product_id, location_id, period_date,                                │
│    SUM(quantity) as quantity, SUM(amount) as amount                     │
│  FROM actuals                                                            │
│  WHERE tenant_id = :tenant_id                                           │
│    AND period_date >= :history_start                                    │
│    AND period_date < :forecast_start                                    │
│  GROUP BY product_id, location_id, period_date                          │
│  ORDER BY period_date;                                                   │
│                                                                          │
│  Result: Time series per dimension combination                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Product A, Location 1: [100, 120, 95, 140, 130, 150, ...]       │    │
│  │ Product A, Location 2: [200, 180, 220, 190, 210, 230, ...]      │    │
│  │ Product B, Location 1: [50, 55, 48, 60, 58, 65, ...]            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 3: FORECAST ENGINE EXECUTION                                       │
│  ────────────────────────────────                                        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  PLUGGABLE FORECAST ENGINE                                          │ │
│  │  ─────────────────────────────                                      │ │
│  │                                                                      │ │
│  │  interface ForecastModel {                                          │ │
│  │    name: string;                                                    │ │
│  │    fit(historicalData: TimeSeries): ModelState;                     │ │
│  │    predict(state: ModelState, periods: number): Prediction[];       │ │
│  │    getConfidence(prediction: Prediction): ConfidenceInterval;       │ │
│  │  }                                                                  │ │
│  │                                                                      │ │
│  │  // Model Selection                                                 │ │
│  │  const model = ForecastModelRegistry.get('HOLT_WINTERS');           │ │
│  │                                                                      │ │
│  │  // Parallel processing per dimension combination                   │ │
│  │  const results = await Promise.all(                                 │ │
│  │    timeSeries.map(async (series) => {                               │ │
│  │      const state = model.fit(series.historicalData);                │ │
│  │      const predictions = model.predict(state, forecastPeriods);     │ │
│  │      return { dimensions: series.dimensions, predictions };         │ │
│  │    })                                                               │ │
│  │  );                                                                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 4: APPLY ASSUMPTIONS & ADJUSTMENTS                                 │
│  ───────────────────────────────────────                                 │
│                                                                          │
│  • Load scenario-specific assumptions                                    │
│  • Apply growth rate adjustments                                         │
│  • Apply price/volume splits                                             │
│  • Apply any existing manual overrides                                   │
│                                                                          │
│  adjustedForecast = baseForecast * (1 + growthAssumption)               │
│                   * seasonalityFactor                                    │
│                   * promotionImpact                                      │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 5: CALCULATE METRICS                                               │
│  ─────────────────────────                                               │
│                                                                          │
│  • MAPE (Mean Absolute Percentage Error)                                 │
│  • RMSE (Root Mean Square Error)                                         │
│  • MAE (Mean Absolute Error)                                             │
│  • Confidence intervals (80%, 95%)                                       │
│  • Forecast vs Last Year comparison                                      │
│                                                                          │
│  {                                                                        │
│    "accuracy_metrics": {                                                 │
│      "mape": 8.5,                                                        │
│      "rmse": 1250.0,                                                     │
│      "mae": 980.0                                                        │
│    },                                                                    │
│    "confidence_intervals": {                                             │
│      "80": { "lower": 0.92, "upper": 1.08 },                            │
│      "95": { "lower": 0.85, "upper": 1.15 }                             │
│    }                                                                     │
│  }                                                                        │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 6: STORE FORECAST RESULTS                                          │
│  ──────────────────────────────                                          │
│                                                                          │
│  INSERT INTO forecasts (                                                 │
│    tenant_id, plan_version_id, scenario_id, forecast_model,             │
│    product_id, location_id, period_date,                                │
│    forecast_quantity, forecast_amount,                                   │
│    confidence_lower, confidence_upper,                                   │
│    is_override, override_reason, created_by                             │
│  ) VALUES ...                                                            │
│                                                                          │
│  • Update job status: COMPLETED                                          │
│  • Invalidate relevant caches                                            │
│  • Send notification to user                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

## 5. Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SECURITY ARCHITECTURE                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  AUTHENTICATION FLOW                                                      │
│  ───────────────────                                                      │
│                                                                          │
│  1. User Login Request                                                   │
│     POST /api/auth/login                                                 │
│     { "email": "user@acme.com", "password": "***" }                     │
│                                                                          │
│  2. Validate Credentials                                                 │
│     • Check user exists in tenant                                        │
│     • Verify password hash (bcrypt)                                      │
│     • Check account status (active, not locked)                          │
│                                                                          │
│  3. Generate JWT Token                                                   │
│     {                                                                    │
│       "sub": "user-uuid",                                               │
│       "tenant_id": "tenant-uuid",                                       │
│       "roles": ["PLANNER"],                                             │
│       "permissions": ["forecast:read", "forecast:write", "plan:read"],  │
│       "iat": 1706544000,                                                │
│       "exp": 1706630400                                                 │
│     }                                                                    │
│                                                                          │
│  4. Return Token + Refresh Token                                         │
│     • Access token: 15 min expiry                                        │
│     • Refresh token: 7 day expiry (stored in httpOnly cookie)           │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  RBAC MODEL                                                               │
│  ──────────                                                               │
│                                                                          │
│  Roles:                                                                  │
│  ┌────────────┬───────────────────────────────────────────────────────┐ │
│  │ ADMIN      │ Full access to all features + user management         │ │
│  ├────────────┼───────────────────────────────────────────────────────┤ │
│  │ PLANNER    │ Create/edit forecasts, scenarios, upload data         │ │
│  ├────────────┼───────────────────────────────────────────────────────┤ │
│  │ FINANCE    │ View all, approve/lock plans, limited edit            │ │
│  ├────────────┼───────────────────────────────────────────────────────┤ │
│  │ VIEWER     │ Read-only access to dashboards and reports            │ │
│  └────────────┴───────────────────────────────────────────────────────┘ │
│                                                                          │
│  Permission Matrix:                                                      │
│  ┌─────────────────────┬───────┬─────────┬─────────┬────────┐          │
│  │ Permission          │ ADMIN │ PLANNER │ FINANCE │ VIEWER │          │
│  ├─────────────────────┼───────┼─────────┼─────────┼────────┤          │
│  │ user:manage         │   ✓   │         │         │        │          │
│  │ actuals:upload      │   ✓   │    ✓    │         │        │          │
│  │ actuals:read        │   ✓   │    ✓    │    ✓    │   ✓    │          │
│  │ plan:create         │   ✓   │    ✓    │         │        │          │
│  │ plan:approve        │   ✓   │         │    ✓    │        │          │
│  │ plan:lock           │   ✓   │         │    ✓    │        │          │
│  │ forecast:generate   │   ✓   │    ✓    │         │        │          │
│  │ forecast:override   │   ✓   │    ✓    │         │        │          │
│  │ scenario:create     │   ✓   │    ✓    │         │        │          │
│  │ scenario:delete     │   ✓   │    ✓    │         │        │          │
│  │ report:export       │   ✓   │    ✓    │    ✓    │   ✓    │          │
│  └─────────────────────┴───────┴─────────┴─────────┴────────┘          │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  API AUTHORIZATION                                                        │
│  ─────────────────                                                        │
│                                                                          │
│  @Controller('forecasts')                                                │
│  @UseGuards(JwtAuthGuard, RolesGuard)                                   │
│  export class ForecastController {                                       │
│                                                                          │
│    @Post('generate')                                                     │
│    @RequirePermissions('forecast:generate')                              │
│    async generateForecast(@Body() dto: GenerateForecastDto) {           │
│      // Only users with forecast:generate permission can access         │
│    }                                                                     │
│                                                                          │
│    @Get(':id')                                                           │
│    @RequirePermissions('forecast:read')                                  │
│    async getForecast(@Param('id') id: string) {                         │
│      // All authenticated users can read                                 │
│    }                                                                     │
│  }                                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## 6. Scalability Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SCALABILITY ARCHITECTURE                                │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  HORIZONTAL SCALING                                                       │
│  ──────────────────                                                       │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     KUBERNETES CLUSTER                               ││
│  │  ┌───────────────────────────────────────────────────────────────┐  ││
│  │  │  API PODS (Auto-scaling: 3-20 replicas)                       │  ││
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │  ││
│  │  │  │ API-1   │ │ API-2   │ │ API-3   │ │ API-4   │ │ API-N   │ │  ││
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │  ││
│  │  └───────────────────────────────────────────────────────────────┘  ││
│  │  ┌───────────────────────────────────────────────────────────────┐  ││
│  │  │  WORKER PODS (Auto-scaling: 2-10 replicas)                    │  ││
│  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │  ││
│  │  │  │ Worker-1  │ │ Worker-2  │ │ Worker-3  │ │ Worker-N  │     │  ││
│  │  │  │ Forecast  │ │ Import    │ │ Export    │ │ General   │     │  ││
│  │  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘     │  ││
│  │  └───────────────────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  DATABASE SCALING                                                         │
│  ────────────────                                                         │
│                                                                          │
│  PostgreSQL with Table Partitioning:                                     │
│                                                                          │
│  -- Partition actuals by period (monthly)                                │
│  CREATE TABLE actuals (                                                  │
│    id UUID,                                                              │
│    tenant_id UUID,                                                       │
│    period_date DATE,                                                     │
│    ...                                                                   │
│  ) PARTITION BY RANGE (period_date);                                     │
│                                                                          │
│  CREATE TABLE actuals_2025_01 PARTITION OF actuals                       │
│    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');                     │
│  CREATE TABLE actuals_2025_02 PARTITION OF actuals                       │
│    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');                     │
│  -- ... auto-create partitions via pg_partman                            │
│                                                                          │
│  Read Replicas:                                                          │
│  ┌────────────────┐      ┌────────────────┐      ┌────────────────┐     │
│  │   PRIMARY      │─────►│   REPLICA 1    │      │   REPLICA 2    │     │
│  │   (Write)      │      │   (Read)       │      │   (Read)       │     │
│  │                │─────►│   Dashboard    │      │   Reports      │     │
│  └────────────────┘      └────────────────┘      └────────────────┘     │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  CACHING STRATEGY                                                         │
│  ────────────────                                                         │
│                                                                          │
│  Multi-Layer Cache:                                                      │
│                                                                          │
│  L1: In-Memory (Node.js)                                                 │
│  ├── Tenant configs: 5 min TTL                                          │
│  └── Dimension lookups: 15 min TTL                                       │
│                                                                          │
│  L2: Redis                                                               │
│  ├── Forecast results: 1 hour TTL                                        │
│  ├── Dashboard aggregations: 5 min TTL                                   │
│  ├── Session data: 24 hour TTL                                           │
│  └── Rate limiting counters: 1 min sliding window                        │
│                                                                          │
│  L3: PostgreSQL Materialized Views                                       │
│  ├── Monthly aggregations: Refresh hourly                                │
│  ├── YoY comparisons: Refresh daily                                      │
│  └── Tenant summaries: Refresh on demand                                 │
│                                                                          │
│  Cache Invalidation:                                                     │
│  • Event-driven invalidation on data changes                             │
│  • Tenant-scoped cache keys: {tenant_id}:{resource}:{id}                │
│  • Bulk invalidation for forecast regeneration                           │
└──────────────────────────────────────────────────────────────────────────┘
```
