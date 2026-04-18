/* eslint-disable */
// Daily forecast seeder — uses existing DAILY actuals as history
// Run inside API container:
//   docker cp scripts/seed-forecasts.js forecast-saas-api-1:/app/seed-forecasts.js
//   docker compose --env-file .env.docker exec api node seed-forecasts.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const { createHmac } = require('node:crypto');

const API_BASE = 'http://localhost:3000/api/v1';

// ── JWT helpers ──────────────────────────────────────────────────────────
function b64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str).toString('base64url');
}

function signJwt(payload, secret) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// ── API caller ───────────────────────────────────────────────────────────
async function api(method, path, token, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    console.error(`  ✗ ${method} ${path} → ${res.status}`);
    console.error('   ', JSON.stringify(json, null, 2).slice(0, 600));
    throw new Error(`API ${res.status}: ${json.message || text.slice(0, 120)}`);
  }
  return json;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const prisma = new PrismaClient();

  try {
    // ── 1. Discover tenant + admin ──────────────────────────────────────
    console.log('==> Discovering tenant with actuals data...');
    const rows = await prisma.$queryRaw`
      SELECT t.id        AS "tenantId",
             t.slug,
             t.name      AS "tenantName",
             COUNT(a.id)::int AS "actualsCount",
             MIN(a.period_date) AS "minDate",
             MAX(a.period_date) AS "maxDate",
             COUNT(DISTINCT a.period_date)::int AS "distinctDates",
             COUNT(DISTINCT a.product_id)::int  AS "distinctProducts"
      FROM   tenants t
      JOIN   actuals a ON a.tenant_id = t.id
      WHERE  t.status = 'ACTIVE'
      GROUP  BY t.id, t.slug, t.name
      ORDER  BY COUNT(a.id) DESC
      LIMIT  1
    `;
    if (!rows?.length) { console.error('No tenant with actuals data.'); process.exit(1); }

    const tenant = rows[0];
    const maxDate = new Date(tenant.maxDate);
    // Plan starts the day AFTER the last actual so history lookback finds data
    const planStart = new Date(maxDate);
    planStart.setDate(planStart.getDate() + 1);
    // Plan spans 45 days
    const planEnd = new Date(planStart);
    planEnd.setDate(planEnd.getDate() + 44);

    console.log(`   Tenant  : ${tenant.tenantName} (${tenant.slug})`);
    console.log(`   Actuals : ${tenant.actualsCount} rows, ${fmt(tenant.minDate)} → ${fmt(maxDate)}`);
    console.log(`             ${tenant.distinctDates} distinct days, ${tenant.distinctProducts} products`);
    console.log(`   Plan window: ${fmt(planStart)} → ${fmt(planEnd)} (DAILY, 45 days)`);

    const adminUser = await prisma.user.findFirst({
      where: { tenantId: tenant.tenantId, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true, email: true, role: true },
    });
    if (!adminUser) { console.error('No active ADMIN user.'); process.exit(1); }
    console.log(`   Admin   : ${adminUser.email}`);

    // ── 2a. Ensure sufficient actuals per dimension ─────────────────────
    // The forecast engine needs >= 3 data points per product-location dimension.
    // If existing actuals are too sparse, backfill synthetic daily data.
    console.log('\n==> Checking data density per product-location dimension...');
    const sparseDims = await prisma.$queryRaw`
      SELECT product_id   AS "productId",
             location_id  AS "locationId",
             COUNT(*)::int AS "cnt",
             MIN(period_date) AS "minDate",
             MAX(period_date) AS "maxDate",
             AVG(amount)::float AS "avgAmount"
      FROM   actuals
      WHERE  tenant_id = ${tenant.tenantId}::uuid
      GROUP  BY product_id, location_id
      HAVING COUNT(*) < 6
    `;

    if (sparseDims.length > 0) {
      console.log(`   Found ${sparseDims.length} sparse dimension(s) with < 6 data points — backfilling...`);
      const targetDays = 15; // ensure at least 15 daily data points per dimension
      let backfillCount = 0;

      for (const dim of sparseDims) {
        const needed = targetDays - dim.cnt;
        if (needed <= 0) continue;

        const baseAmount = dim.avgAmount || 1000;
        const endDate = dim.maxDate ? new Date(dim.maxDate) : maxDate;

        for (let i = 1; i <= needed; i++) {
          const d = new Date(endDate);
          d.setDate(d.getDate() - (dim.cnt + i)); // fill backwards before existing data
          // Add ±20% random variance to make the data realistic
          const variance = 0.8 + Math.random() * 0.4;
          const amount = Math.round(baseAmount * variance * 100) / 100;
          const quantity = Math.max(1, Math.round(amount / 100));

          await prisma.actual.create({
            data: {
              tenantId: tenant.tenantId,
              productId: dim.productId,
              locationId: dim.locationId,
              periodDate: d,
              periodType: 'DAILY',
              amount,
              quantity,
              currency: 'INR',
            },
          });
          backfillCount++;
        }
      }
      console.log(`   Backfilled ${backfillCount} synthetic actuals rows.`);
    } else {
      console.log('   All dimensions have >= 6 data points — no backfill needed.');
    }

    // ── 2. JWT ──────────────────────────────────────────────────────────
    const secret = process.env.JWT_SECRET;
    if (!secret) { console.error('JWT_SECRET env var required.'); process.exit(1); }

    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({
      sub: adminUser.id,
      email: adminUser.email,
      tenantId: tenant.tenantId,
      tenantSlug: tenant.slug,
      role: adminUser.role,
      permissions: [
        'plans:read', 'plans:write',
        'forecasts:read', 'forecasts:write',
        'scenarios:read', 'scenarios:write',
        'actuals:read',
      ],
      moduleAccess: { planning: true, forecasting: true },
      roleId: null,
      roleName: adminUser.role,
      iat: now,
      exp: now + 3600,
    }, secret);

    // ── 3. Create or reuse DAILY plan ─────────────────────────────────
    const planName = `Daily Forecast ${fmt(planStart)} to ${fmt(planEnd)}`;
    console.log(`\n==> Looking for existing plan "${planName}"...`);

    let plan;
    const existingPlans = await api('GET', `/plans?pageSize=100`, token);
    const ePlans = existingPlans.data || (Array.isArray(existingPlans) ? existingPlans : []);
    plan = ePlans.find((p) => p.name === planName);

    if (plan) {
      console.log(`   Found existing plan: ${plan.name} (${plan.id})`);
    } else {
      console.log('   Creating new plan...');
      plan = await api('POST', '/plans', token, {
        name: planName,
        description:
          `Short-term daily production forecast using ${tenant.distinctDates} days of ` +
          `historical actuals across ${tenant.distinctProducts} products. ` +
          `Models: Moving Average, Weighted Average, Linear Regression.`,
        startDate: fmt(planStart),
        endDate: fmt(planEnd),
        planType: 'FORECAST',
        periodType: 'DAILY',
      });
      console.log(`   Created plan: ${plan.name} (${plan.id})`);
    }
    const planVersionId = plan.id;

    // ── 4. Retrieve auto-created Base scenario ──────────────────────────
    const scenarioList = await api('GET', `/scenarios?planVersionId=${planVersionId}`, token);
    const sArr = Array.isArray(scenarioList) ? scenarioList : (scenarioList.data || []);
    const baseScenario = sArr.find((s) => s.scenarioType === 'BASE');
    if (!baseScenario) { console.error('Base scenario not found!'); process.exit(1); }
    console.log(`   Base scenario: ${baseScenario.id}`);

    // ── 5. Create additional scenarios ──────────────────────────────────
    console.log('\n==> Creating scenarios...');
    const extras = [
      { name: 'Optimistic Growth',       scenarioType: 'OPTIMISTIC',   color: '#22c55e', sortOrder: 1,
        description: '+15% growth adjustment — market expansion outlook.' },
      { name: 'Conservative Downside',   scenarioType: 'PESSIMISTIC',  color: '#ef4444', sortOrder: 2,
        description: '-15% adjustment — supply chain risk / market contraction.' },
      { name: 'Steady State',            scenarioType: 'CONSERVATIVE', color: '#f59e0b', sortOrder: 3,
        description: '-8% with tighter confidence — flat demand outlook.' },
    ];
    const createdScenarios = [];
    for (const sc of extras) {
      // Skip if scenario already exists for this plan
      const existing = sArr.find((s) => s.scenarioType === sc.scenarioType);
      if (existing) {
        console.log(`   Reusing: ${existing.name} (${existing.scenarioType})`);
        createdScenarios.push(existing);
        continue;
      }
      const c = await api('POST', '/scenarios', token, { ...sc, planVersionId });
      console.log(`   ${c.name} (${c.scenarioType})`);
      createdScenarios.push(c);
    }

    // ── 6. Generate forecasts ───────────────────────────────────────────
    // Models suited for 15 daily data points:
    //  MOVING_AVERAGE    (min 3 points)
    //  WEIGHTED_AVERAGE  (min 3 points)
    //  LINEAR_REGRESSION (min 6 points)
    const models = ['MOVING_AVERAGE', 'WEIGHTED_AVERAGE', 'LINEAR_REGRESSION'];
    const allScenarios = [baseScenario, ...createdScenarios];

    let grandTotal = 0;
    for (const sc of allScenarios) {
      console.log(`\n==> Generating forecasts: "${sc.name}" (${sc.scenarioType})...`);
      console.log(`   Models: ${models.join(', ')} | DAILY x 45 days`);

      try {
        const result = await api('POST', '/forecasts/generate', token, {
          planVersionId,
          scenarioId: sc.id,
          models,
          periods: 45,
          periodType: 'DAILY',
          persist: true,
        });

        const runs = result.runs || [];
        const total = result.forecasts?.length ??
          runs.reduce((s, r) => s + (r.forecastCount || 0), 0);
        grandTotal += total;
        console.log(`   ${total} forecast rows across ${runs.length} run(s)`);
        for (const r of runs) {
          console.log(`     ${pad(r.forecastModel || r.model, 20)} ${r.status}`);
        }
      } catch (err) {
        console.error(`   Failed: ${err.message}`);
      }
    }

    // ── Summary ─────────────────────────────────────────────────────────
    console.log('\n========================================================');
    console.log(' Forecast Seed Complete');
    console.log('--------------------------------------------------------');
    console.log(` Plan      : ${plan.name}`);
    console.log(` Period    : ${fmt(planStart)} -> ${fmt(planEnd)} (DAILY)`);
    console.log(` History   : ${tenant.distinctDates} days, ${tenant.distinctProducts} products`);
    console.log(` Scenarios : Base, Optimistic (+15%), Pessimistic (-15%), Conservative (-8%)`);
    console.log(` Algorithms: Moving Average, Weighted Average, Linear Regression`);
    console.log(` Total rows: ${grandTotal}`);
    console.log('========================================================\n');

  } finally {
    await prisma.$disconnect();
  }
}

function fmt(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d ?? '?');
}
function pad(s, n) { return String(s || '').padEnd(n); }

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
