/**
 * Demo seed: creates realistic plans, scenarios, and forecasts
 * using Marg-synced products/locations/actuals.
 *
 * Schema-accurate version — all field names verified against schema.prisma.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Seeded PRNG (mulberry32) for deterministic variation
function rng(seed) {
  let s = seed;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(8675309);

function jitter(base, pct = 0.12) {
  return Math.round(base * (1 - pct + rand() * pct * 2) * 100) / 100;
}

// Monthly seasonal index (Jan-Dec, Nepali market: peaks Oct-Nov Dashain/Tihar)
const SEASONAL = [0.82, 0.85, 0.92, 1.0, 1.05, 1.08, 1.02, 0.97, 1.04, 1.22, 1.30, 1.18];

function monthlyQty(base, month, year, growth = 0.08) {
  const yf = 1 + growth * (year - 2025);
  return Math.max(1, Math.round(jitter(base * SEASONAL[month] * yf)));
}

function monthlyAmt(baseAmt, month, year, growth = 0.08) {
  const yf = 1 + growth * (year - 2025);
  return Math.max(1, Math.round(jitter(baseAmt * SEASONAL[month] * yf)));
}

const getBase = (product) => {
  const n = (product.name || '').toLowerCase();
  const c = (product.code || '').toLowerCase();
  if (n.includes('campa') || n.includes('cola')) return { qty: 120, unitPrice: 866 };
  if (n.includes('new item') || c.includes('r9066')) return { qty: 80, unitPrice: 737 };
  if (c.includes('1000004')) return { qty: 200, unitPrice: 15 };
  if (c.includes('1000005')) return { qty: 150, unitPrice: 16 };
  if (c.includes('37')) return { qty: 90, unitPrice: 25 };
  if (c.includes('74')) return { qty: 60, unitPrice: 127 };
  return { qty: 50, unitPrice: 200 };
};

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'planning' } });
  if (!tenant) throw new Error('Tenant "planning" not found. Run clean-seed.js first.');

  const products = await prisma.product.findMany({ where: { tenantId: tenant.id }, orderBy: { code: 'asc' } });
  if (products.length === 0) throw new Error('No products found. Sync from Marg EDE first.');

  const locations = await prisma.location.findMany({ where: { tenantId: tenant.id }, orderBy: { name: 'asc' } });
  const mainLocation = locations.find(l => l.name?.toLowerCase().includes('corporate')) || locations[0];
  const altLocation = locations.find(l => l.id !== mainLocation.id) || null;
  const adminUser = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'ADMIN' } });

  console.log(`Tenant: ${tenant.name}  Products: ${products.length}  Locations: ${locations.length}`);
  console.log(`Main location: ${mainLocation.name}`);

  // ─── Clean previous demo data ──────────────────────────────────────
  console.log('\n Clearing prior demo data...');
  await prisma.forecastResult.deleteMany({ where: { tenantId: tenant.id } });
  try { await prisma.forecastOverride.deleteMany({ where: { tenantId: tenant.id } }); } catch {}
  await prisma.forecast.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.forecastRun.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.assumption.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.scenario.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.planVersion.deleteMany({ where: { tenantId: tenant.id } });
  // Remove any synthetic actuals (no sourceSystem), keep only real Marg-synced ones
  await prisma.actual.deleteMany({ where: { tenantId: tenant.id, sourceSystem: null } });
  const totalActuals = await prisma.actual.count({ where: { tenantId: tenant.id } });
  console.log(`\n Keeping ${totalActuals} real Marg-synced actuals (synthetic data removed).`);

  // ─────────────────────────────────────────────────────────────────
  // PLANS — planType: BUDGET | FORECAST | STRATEGIC | WHAT_IF
  // ─────────────────────────────────────────────────────────────────
  console.log('\n Creating plans...');
  const plan1 = await prisma.planVersion.create({
    data: {
      tenantId: tenant.id,
      name: 'Annual Sales Plan FY2026',
      description: 'Full-year revenue and volume targets for FY2026 across all product lines and branch locations. Approved by management on Jan 10.',
      planType: 'BUDGET',
      status: 'APPROVED',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      periodType: 'MONTHLY',
      createdById: adminUser.id,
      approvedById: adminUser.id,
      approvedAt: new Date('2026-01-10'),
    },
  });

  const plan2 = await prisma.planVersion.create({
    data: {
      tenantId: tenant.id,
      name: 'Q2 2026 Demand Plan',
      description: 'Short-cycle demand plan for April–June 2026. Incorporates Marg EDE transaction data and seasonal adjustments for Nepali summer season.',
      planType: 'FORECAST',
      status: 'IN_REVIEW',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-06-30'),
      periodType: 'MONTHLY',
      createdById: adminUser.id,
    },
  });

  const plan3 = await prisma.planVersion.create({
    data: {
      tenantId: tenant.id,
      name: '18-Month Rolling Forecast',
      description: 'Rolling 18-month forward plan updated monthly. Basis for procurement and inventory decisions. Includes Dashain/Tihar seasonal uplift in Q4.',
      planType: 'FORECAST',
      status: 'DRAFT',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-09-30'),
      periodType: 'MONTHLY',
      createdById: adminUser.id,
    },
  });
  console.log(`  ${plan1.name} [${plan1.status}]`);
  console.log(`  ${plan2.name} [${plan2.status}]`);
  console.log(`  ${plan3.name} [${plan3.status}]`);

  // ─────────────────────────────────────────────────────────────────
  // SCENARIOS — scenarioType: BASE | OPTIMISTIC | PESSIMISTIC | STRETCH | CONSERVATIVE | CUSTOM
  // ─────────────────────────────────────────────────────────────────
  console.log('\n Creating scenarios...');

  const s1 = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan1.id,
      name: 'Base Case',
      description: 'Assumes 8% YoY growth, stable Nepali market conditions. Consistent with Marg EDE transaction trends Jan–Apr 2026. Primary planning baseline.',
      scenarioType: 'BASE',
      status: 'APPROVED',
      isBaseline: true,
      color: '#3B82F6',
      sortOrder: 1,
    },
  });

  const s2 = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan1.id,
      name: 'Upside — Dashain Surge',
      description: 'Optimistic: Dashain/Tihar festival season drives 30% Oct-Nov volume spike. Three new branch openings in Q3 expand distribution reach.',
      scenarioType: 'OPTIMISTIC',
      status: 'DRAFT',
      isBaseline: false,
      color: '#10B981',
      sortOrder: 2,
    },
  });

  const s3 = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan1.id,
      name: 'Downside — Supply Constraint',
      description: 'Conservative: supplier lead time +3 weeks from Q2. Campa Cola import delays reduce beverage availability. Risk mitigation basis.',
      scenarioType: 'PESSIMISTIC',
      status: 'DRAFT',
      isBaseline: false,
      color: '#EF4444',
      sortOrder: 3,
    },
  });

  const s4 = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan1.id,
      name: 'Stretch — Aggressive Expansion',
      description: 'Stretch target: 5 new branches, expanded product catalogue, trade promotions in Q3–Q4. Requires capital approval by June 2026.',
      scenarioType: 'STRETCH',
      status: 'DRAFT',
      isBaseline: false,
      color: '#8B5CF6',
      sortOrder: 4,
    },
  });

  // Assumptions (assumptionType: GROWTH_RATE|PRICE_CHANGE|VOLUME_CHANGE|COST_INFLATION|SEASONALITY|PROMOTION|CUSTOM)
  // value must be Decimal (numeric), valueType: PERCENTAGE
  const assumptions = [
    { planVersionId: plan1.id, scenarioId: s1.id, tenantId: tenant.id, name: 'YoY Volume Growth', description: 'CAGR-aligned volume growth', assumptionType: 'GROWTH_RATE', value: 8.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s1.id, tenantId: tenant.id, name: 'Price Inflation Pass-through', description: 'Selling price increase to offset COGS inflation', assumptionType: 'PRICE_CHANGE', value: 3.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s2.id, tenantId: tenant.id, name: 'YoY Volume Growth', description: 'Higher growth from festival season and new branches', assumptionType: 'GROWTH_RATE', value: 20.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s2.id, tenantId: tenant.id, name: 'Dashain/Tihar Seasonal Uplift', description: 'Oct-Nov festival season incremental volume', assumptionType: 'SEASONALITY', value: 30.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s2.id, tenantId: tenant.id, name: 'New Branch Contribution', description: 'Revenue from 3 new branch openings in Q3', assumptionType: 'VOLUME_CHANGE', value: 12.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s3.id, tenantId: tenant.id, name: 'YoY Volume Growth', description: 'Reduced growth from supply disruption', assumptionType: 'GROWTH_RATE', value: -2.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s3.id, tenantId: tenant.id, name: 'Import Cost Inflation', description: 'Landed cost increase on imported goods', assumptionType: 'COST_INFLATION', value: 8.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s3.id, tenantId: tenant.id, name: 'Beverage Volume Reduction', description: 'Campa Cola availability constrained in Q2', assumptionType: 'VOLUME_CHANGE', value: -15.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s4.id, tenantId: tenant.id, name: 'YoY Volume Growth', description: 'Aggressive growth from expansion and promotions', assumptionType: 'GROWTH_RATE', value: 30.0, valueType: 'PERCENTAGE' },
    { planVersionId: plan1.id, scenarioId: s4.id, tenantId: tenant.id, name: 'Trade Promotion Uplift', description: 'Q3-Q4 trade promo spend drives incremental demand', assumptionType: 'PROMOTION', value: 18.0, valueType: 'PERCENTAGE' },
  ];
  await prisma.assumption.createMany({ data: assumptions });
  console.log(`  4 scenarios + ${assumptions.length} assumptions created`);

  // ─────────────────────────────────────────────────────────────────
  // FORECAST RUNS + FORECAST ROWS (one row per product x period x scenario)
  // ForecastRun fields: modelVersion (required), inputSnapshot (required), startPeriod, endPeriod, requestedById
  // Forecast fields: forecastAmount (not amount), createdById (required), periodDate (not period)
  // ForecastResult fields: forecastAmount (not amount), forecastRunId (required)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n Creating forecast runs and monthly data...');

  const scenarioConfigs = [
    { scenario: s1, mult: 1.00, model: 'HOLT_WINTERS',    uncertainty: 0.10 },
    { scenario: s2, mult: 1.22, model: 'TREND_PERCENT',   uncertainty: 0.18 },
    { scenario: s3, mult: 0.88, model: 'MOVING_AVERAGE',  uncertainty: 0.14 },
    { scenario: s4, mult: 1.38, model: 'SEASONAL_NAIVE',  uncertainty: 0.20 },
  ];

  let totalForecastRows = 0;

  for (const { scenario, mult, model, uncertainty } of scenarioConfigs) {
    // ForecastRun — requires modelVersion, inputSnapshot, startPeriod, endPeriod, requestedById
    const run = await prisma.forecastRun.create({
      data: {
        tenantId: tenant.id,
        planVersionId: plan1.id,
        scenarioId: scenario.id,
        forecastModel: model,
        modelVersion: '1.0',
        status: 'COMPLETED',
        parameters: { alpha: 0.3, beta: 0.1, gamma: 0.2, seasonalPeriods: 12 },
        inputSnapshot: { productsCount: products.length, historicalMonths: 15, dataSource: 'MARG_EDE' },
        startPeriod: new Date('2026-01-01'),
        endPeriod: new Date('2026-12-31'),
        requestedById: adminUser.id,
        startedAt: new Date('2026-04-01T06:00:00Z'),
        completedAt: new Date('2026-04-01T06:03:22Z'),
      },
    });

    const forecastRows = [];
    const resultRows = [];

    for (const product of products) {
      const base = getBase(product);
      for (let m = 0; m < 12; m++) {
        const date = new Date(Date.UTC(2026, m, 1));
        const month = date.getUTCMonth();
        const fqty = monthlyQty(base.qty * mult, month, 2026);
        const famt = monthlyAmt(base.qty * base.unitPrice * mult, month, 2026);
        const ci = Math.round(85 - uncertainty * 100 * 0.5);

        // Forecast row: forecastAmount (required), createdById (required)
        forecastRows.push({
          tenantId: tenant.id,
          planVersionId: plan1.id,
          scenarioId: scenario.id,
          forecastRunId: run.id,
          forecastModel: model,
          periodDate: date,
          periodType: 'MONTHLY',
          productId: product.id,
          locationId: mainLocation.id,
          forecastQuantity: fqty,
          forecastAmount: famt,
          currency: 'NPR',
          confidenceLower: Math.round(famt * (1 - uncertainty)),
          confidenceUpper: Math.round(famt * (1 + uncertainty)),
          confidenceLevel: ci,
          createdById: adminUser.id,
        });

        // ForecastResult row: forecastAmount (not amount), forecastRunId (required)
        resultRows.push({
          tenantId: tenant.id,
          forecastRunId: run.id,
          periodDate: date,
          periodType: 'MONTHLY',
          productId: product.id,
          locationId: mainLocation.id,
          forecastQuantity: fqty,
          forecastAmount: famt,
          currency: 'NPR',
          confidenceLower: Math.round(famt * (1 - uncertainty)),
          confidenceUpper: Math.round(famt * (1 + uncertainty)),
          confidenceLevel: ci,
        });
      }
    }

    await prisma.forecast.createMany({ data: forecastRows, skipDuplicates: true });
    await prisma.forecastResult.createMany({ data: resultRows, skipDuplicates: true });
    totalForecastRows += forecastRows.length;
    console.log(`  ${scenario.name}: ${forecastRows.length} forecast rows`);
  }

  // ─── Summary ──────────────────────────────────────────────────────
  console.log('\n Demo data ready!');
  console.log(`  Plans:     3 (Annual FY2026 / Q2 2026 / 18-Month Rolling)`);
  console.log(`  Scenarios: 4 (Base / Upside / Downside / Stretch)`);
  console.log(`  Forecasts: ${totalForecastRows} rows (4 scenarios x ${products.length} products x 12 months)`);
  console.log(`  Actuals:   ${totalActuals} real records from Marg EDE sync`);
  console.log(`\n  Login: admin@planning.rabbittech.com.np / Admin123!`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\nError:', e.message);
  if (e.meta) console.error('Meta:', JSON.stringify(e.meta));
  await prisma.$disconnect();
  process.exit(1);
});