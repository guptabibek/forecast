import { PeriodType, PlanStatus, PlanType, PrismaClient, ScenarioType, UomCategory } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Production-safe seed — creates infrastructure + default planning structure:
 *   - Tenant (upsert)
 *   - Domain mapping
 *   - Admin user (upsert)
 *   - Unit of measure master
 *   - Product category master
 *   - Time buckets (2024–2027)
 *   - Default demand plan (current FY)
 *   - 3 scenarios: Base, Optimistic, Pessimistic
 *
 * Does NOT create demo products, locations, customers, actuals,
 * forecasts, or manufacturing data.
 * All business data comes from Marg EDE sync or user input.
 */

const DEFAULT_TENANT_SETTINGS = {
  dateFormat: 'MM/DD/YYYY',
  defaultForecastModel: 'HOLT_WINTERS',
  features: {
    aiForecasting: true,
    advancedReporting: true,
    scenarioPlanning: true,
  },
} as const;

const DEFAULT_TENANT_UOMS: ReadonlyArray<{
  code: string;
  name: string;
  symbol?: string;
  category: UomCategory;
  decimals: number;
  isBase: boolean;
  sortOrder: number;
}> = [
  { code: 'EA', name: 'Each', symbol: 'ea', category: UomCategory.COUNT, decimals: 0, isBase: true, sortOrder: 1 },
  { code: 'PR', name: 'Pair', symbol: 'pr', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 2 },
  { code: 'DZ', name: 'Dozen', symbol: 'dz', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 3 },
  { code: 'PKG', name: 'Package', symbol: 'pkg', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 4 },
  { code: 'BOX', name: 'Box', symbol: 'box', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 5 },
  { code: 'CS', name: 'Case', symbol: 'cs', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 6 },
  { code: 'PLT', name: 'Pallet', symbol: 'plt', category: UomCategory.COUNT, decimals: 0, isBase: false, sortOrder: 7 },
  { code: 'G', name: 'Gram', symbol: 'g', category: UomCategory.WEIGHT, decimals: 2, isBase: false, sortOrder: 1 },
  { code: 'KG', name: 'Kilogram', symbol: 'kg', category: UomCategory.WEIGHT, decimals: 3, isBase: true, sortOrder: 2 },
  { code: 'MT', name: 'Metric Ton', symbol: 't', category: UomCategory.WEIGHT, decimals: 4, isBase: false, sortOrder: 3 },
  { code: 'OZ', name: 'Ounce', symbol: 'oz', category: UomCategory.WEIGHT, decimals: 2, isBase: false, sortOrder: 4 },
  { code: 'LB', name: 'Pound', symbol: 'lb', category: UomCategory.WEIGHT, decimals: 3, isBase: false, sortOrder: 5 },
  { code: 'MM', name: 'Millimeter', symbol: 'mm', category: UomCategory.LENGTH, decimals: 1, isBase: false, sortOrder: 1 },
  { code: 'CM', name: 'Centimeter', symbol: 'cm', category: UomCategory.LENGTH, decimals: 2, isBase: false, sortOrder: 2 },
  { code: 'M', name: 'Meter', symbol: 'm', category: UomCategory.LENGTH, decimals: 3, isBase: true, sortOrder: 3 },
  { code: 'IN', name: 'Inch', symbol: 'in', category: UomCategory.LENGTH, decimals: 2, isBase: false, sortOrder: 4 },
  { code: 'FT', name: 'Foot', symbol: 'ft', category: UomCategory.LENGTH, decimals: 3, isBase: false, sortOrder: 5 },
  { code: 'ML', name: 'Milliliter', symbol: 'ml', category: UomCategory.VOLUME, decimals: 1, isBase: false, sortOrder: 1 },
  { code: 'L', name: 'Liter', symbol: 'L', category: UomCategory.VOLUME, decimals: 3, isBase: true, sortOrder: 2 },
  { code: 'GAL', name: 'Gallon', symbol: 'gal', category: UomCategory.VOLUME, decimals: 3, isBase: false, sortOrder: 3 },
  { code: 'FLOZ', name: 'Fluid Ounce', symbol: 'fl oz', category: UomCategory.VOLUME, decimals: 2, isBase: false, sortOrder: 4 },
  { code: 'SQM', name: 'Square Meter', symbol: 'm2', category: UomCategory.AREA, decimals: 3, isBase: true, sortOrder: 1 },
  { code: 'SQFT', name: 'Square Foot', symbol: 'ft2', category: UomCategory.AREA, decimals: 3, isBase: false, sortOrder: 2 },
  { code: 'SEC', name: 'Second', symbol: 's', category: UomCategory.TIME, decimals: 0, isBase: false, sortOrder: 1 },
  { code: 'MIN', name: 'Minute', symbol: 'min', category: UomCategory.TIME, decimals: 1, isBase: false, sortOrder: 2 },
  { code: 'HR', name: 'Hour', symbol: 'hr', category: UomCategory.TIME, decimals: 2, isBase: true, sortOrder: 3 },
  { code: 'DAY', name: 'Day', symbol: 'day', category: UomCategory.TIME, decimals: 2, isBase: false, sortOrder: 4 },
];

const DEFAULT_PRODUCT_CATEGORIES: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  color: string;
  sortOrder: number;
}> = [
  { code: 'RAW_MATERIAL', name: 'Raw Material', description: 'Raw materials and basic inputs', color: '#6366F1', sortOrder: 1 },
  { code: 'COMPONENT', name: 'Component', description: 'Individual components and parts', color: '#8B5CF6', sortOrder: 2 },
  { code: 'SUB_ASSEMBLY', name: 'Sub-Assembly', description: 'Intermediate assemblies', color: '#A855F7', sortOrder: 3 },
  { code: 'FINISHED_GOOD', name: 'Finished Good', description: 'Completed products ready for sale', color: '#10B981', sortOrder: 4 },
  { code: 'PACKAGING', name: 'Packaging', description: 'Packaging materials', color: '#F59E0B', sortOrder: 5 },
  { code: 'CONSUMABLE', name: 'Consumable', description: 'Consumable supplies', color: '#EF4444', sortOrder: 6 },
  { code: 'MRO', name: 'MRO', description: 'Maintenance, Repair and Operations', color: '#06B6D4', sortOrder: 7 },
  { code: 'SERVICE', name: 'Service', description: 'Service and labor items', color: '#84CC16', sortOrder: 8 },
  { code: 'SPARE_PART', name: 'Spare Part', description: 'Spare parts for equipment maintenance', color: '#F97316', sortOrder: 9 },
  { code: 'TOOLING', name: 'Tooling', description: 'Tools, jigs, and fixtures', color: '#64748B', sortOrder: 10 },
];

const prisma = new PrismaClient();

function normalizeTenantSlug(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) return fallback;
  if (['www', 'api', 'app'].includes(normalized)) return fallback;
  return normalized;
}

function getSeedTenantConfig() {
  const frontendUrl = (process.env.FRONTEND_URL || '').trim();
  const mainDomain = (process.env.MAIN_DOMAIN || '').trim().toLowerCase();

  const explicitSlug = process.env.SEED_TENANT_SLUG;
  const explicitName = (process.env.SEED_TENANT_NAME || '').trim();
  const explicitDomain = (process.env.SEED_TENANT_DOMAIN || '').trim().toLowerCase();
  const explicitAdminEmail = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const explicitAdminPassword = (process.env.SEED_ADMIN_PASSWORD || '').trim();

  let frontendHost = '';
  try {
    if (frontendUrl) {
      frontendHost = new URL(frontendUrl).hostname.toLowerCase();
    }
  } catch {
    frontendHost = '';
  }

  const tenantDomain = explicitDomain || frontendHost || 'demo.localhost';
  const hostParts = tenantDomain.split('.').filter(Boolean);

  let derivedSlug = 'demo';
  if (tenantDomain.endsWith('.localhost') && hostParts.length === 2) {
    derivedSlug = hostParts[0];
  } else if (hostParts.length >= 3) {
    derivedSlug = hostParts[0];
  } else if (mainDomain && tenantDomain.endsWith(`.${mainDomain}`)) {
    derivedSlug = tenantDomain.replace(`.${mainDomain}`, '');
  }

  const tenantSlug = normalizeTenantSlug(explicitSlug, normalizeTenantSlug(derivedSlug, 'demo'));
  const tenantName = explicitName || `${tenantSlug.charAt(0).toUpperCase()}${tenantSlug.slice(1)} Company`;
  const adminEmail = explicitAdminEmail || `admin@${tenantDomain}`;
  const adminPassword = explicitAdminPassword || 'Admin123!';

  return { tenantSlug, tenantName, tenantDomain, adminEmail, adminPassword };
}

async function main() {
  console.log('🌱 Starting production seed (infrastructure only)...\n');

  const seedTenant = getSeedTenantConfig();
  const isPublicDomain = !seedTenant.tenantDomain.endsWith('.localhost') && seedTenant.tenantDomain !== 'localhost';
  console.log(`🏢 Tenant: slug=${seedTenant.tenantSlug}, domain=${seedTenant.tenantDomain}`);

  // ── Tenant ──
  const tenant = await prisma.tenant.upsert({
    where: { slug: seedTenant.tenantSlug },
    update: {
      name: seedTenant.tenantName,
      domain: seedTenant.tenantDomain,
      subdomain: seedTenant.tenantSlug,
      status: 'ACTIVE',
      tier: 'PROFESSIONAL',
      timezone: 'Asia/Kathmandu',
      fiscalYearStart: 1,
      defaultCurrency: 'NPR',
      settings: DEFAULT_TENANT_SETTINGS,
    },
    create: {
      name: seedTenant.tenantName,
      slug: seedTenant.tenantSlug,
      domain: seedTenant.tenantDomain,
      subdomain: seedTenant.tenantSlug,
      status: 'ACTIVE',
      tier: 'PROFESSIONAL',
      timezone: 'Asia/Kathmandu',
      fiscalYearStart: 1,
      defaultCurrency: 'NPR',
      settings: DEFAULT_TENANT_SETTINGS,
    },
  });
  console.log(`✅ Tenant: ${tenant.name}`);

  // ── Domain mapping ──
  await prisma.domainMapping.upsert({
    where: { domain: seedTenant.tenantDomain },
    update: { tenantId: tenant.id, isVerified: true, verifiedAt: new Date(), sslEnabled: isPublicDomain },
    create: { tenantId: tenant.id, domain: seedTenant.tenantDomain, isVerified: true, verifiedAt: new Date(), sslEnabled: isPublicDomain },
  });
  console.log(`✅ Domain mapping: ${seedTenant.tenantDomain}`);

  // ── Admin user ──
  const hashedPassword = await bcrypt.hash(seedTenant.adminPassword, 12);
  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: seedTenant.adminEmail } },
    update: { passwordHash: hashedPassword, firstName: 'Admin', lastName: 'User', role: 'ADMIN', status: 'ACTIVE' },
    create: { tenantId: tenant.id, email: seedTenant.adminEmail, passwordHash: hashedPassword, firstName: 'Admin', lastName: 'User', role: 'ADMIN', status: 'ACTIVE' },
  });
  console.log(`✅ Admin: ${seedTenant.adminEmail}`);

  // ── UOMs (upsert, safe for re-runs) ──
  let uomCount = 0;
  for (const u of DEFAULT_TENANT_UOMS) {
    await prisma.unitOfMeasure.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: u.code } },
      update: { name: u.name, symbol: u.symbol, category: u.category, decimals: u.decimals, isBase: u.isBase, sortOrder: u.sortOrder, isActive: true },
      create: { tenantId: tenant.id, code: u.code, name: u.name, symbol: u.symbol, category: u.category, decimals: u.decimals, isBase: u.isBase, isActive: true, sortOrder: u.sortOrder },
    });
    uomCount++;
  }
  console.log(`✅ ${uomCount} units of measure`);

  // ── Product categories (upsert, safe for re-runs) ──
  let catCount = 0;
  for (const c of DEFAULT_PRODUCT_CATEGORIES) {
    await prisma.productCategory.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: { name: c.name, description: c.description, color: c.color, sortOrder: c.sortOrder, isActive: true },
      create: { tenantId: tenant.id, code: c.code, name: c.name, description: c.description, color: c.color, sortOrder: c.sortOrder, isActive: true },
    });
    catCount++;
  }
  console.log(`✅ ${catCount} product categories`);

  // ── Time buckets (2024–2027) ──
  let timeBucketCount = 0;
  const freezeCutoff = new Date();
  freezeCutoff.setMonth(freezeCutoff.getMonth() - 3);
  freezeCutoff.setDate(1);
  freezeCutoff.setHours(0, 0, 0, 0);

  await prisma.timeBucket.deleteMany({ where: { tenantId: tenant.id } });

  for (let year = 2024; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      const bucketStart = new Date(year, month, 1);
      const bucketEnd = new Date(year, month + 1, 0);
      const periodKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      await prisma.timeBucket.create({
        data: { tenantId: tenant.id, periodType: PeriodType.MONTHLY, periodKey, bucketStart, bucketEnd, fiscalYear: year, fiscalQuarter: Math.floor(month / 3) + 1, fiscalMonth: month + 1, isFrozen: bucketStart < freezeCutoff },
      });
      timeBucketCount++;
    }
    for (let q = 0; q < 4; q++) {
      const bucketStart = new Date(year, q * 3, 1);
      const bucketEnd = new Date(year, q * 3 + 3, 0);
      await prisma.timeBucket.create({
        data: { tenantId: tenant.id, periodType: PeriodType.QUARTERLY, periodKey: `${year}-Q${q + 1}`, bucketStart, bucketEnd, fiscalYear: year, fiscalQuarter: q + 1, isFrozen: bucketStart < freezeCutoff },
      });
      timeBucketCount++;
    }
    await prisma.timeBucket.create({
      data: { tenantId: tenant.id, periodType: PeriodType.YEARLY, periodKey: `${year}`, bucketStart: new Date(year, 0, 1), bucketEnd: new Date(year, 11, 31), fiscalYear: year, isFrozen: new Date(year, 0, 1) < freezeCutoff },
    });
    timeBucketCount++;

    let weekDate = new Date(year, 0, 1);
    while (weekDate.getDay() !== 1) weekDate.setDate(weekDate.getDate() + 1);
    while (weekDate.getFullYear() === year) {
      const weekEnd = new Date(weekDate);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekNum = Math.ceil(((weekDate.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7);
      await prisma.timeBucket.create({
        data: { tenantId: tenant.id, periodType: PeriodType.WEEKLY, periodKey: `${year}-W${String(weekNum).padStart(2, '0')}`, bucketStart: new Date(weekDate), bucketEnd: weekEnd.getFullYear() === year ? weekEnd : new Date(year, 11, 31), fiscalYear: year, fiscalWeek: weekNum, isFrozen: weekDate < freezeCutoff },
      });
      timeBucketCount++;
      weekDate.setDate(weekDate.getDate() + 7);
    }
  }
  console.log(`✅ ${timeBucketCount} time buckets`);

  // ── Default Plan + Scenarios (upsert, safe for re-runs) ──
  const now = new Date();
  const fyStart = new Date(now.getFullYear(), 3, 1);   // April 1 (Nepal FY)
  const fyEnd   = new Date(now.getFullYear() + 1, 2, 31); // March 31 next year
  const fyLabel = `FY ${now.getFullYear()}/${(now.getFullYear() + 1).toString().slice(-2)}`;

  const demandPlan = await prisma.planVersion.upsert({
    where: { tenantId_name_version: { tenantId: tenant.id, name: `${fyLabel} Demand Plan`, version: 1 } },
    update: { description: `Annual demand forecast plan for ${fyLabel}`, startDate: fyStart, endDate: fyEnd },
    create: {
      tenantId: tenant.id,
      name: `${fyLabel} Demand Plan`,
      description: `Annual demand forecast plan for ${fyLabel}`,
      planType: PlanType.FORECAST,
      status: PlanStatus.DRAFT,
      version: 1,
      startDate: fyStart,
      endDate: fyEnd,
      periodType: PeriodType.MONTHLY,
      createdById: adminUser.id,
      settings: {},
    },
  });
  console.log(`✅ Plan: ${demandPlan.name}`);

  const scenarioDefs = [
    { name: 'Base',        type: ScenarioType.BASE,        isBaseline: true,  color: '#3B82F6', sort: 1, desc: 'Most-likely demand scenario based on historical trends' },
    { name: 'Optimistic',  type: ScenarioType.OPTIMISTIC,  isBaseline: false, color: '#10B981', sort: 2, desc: 'Upper-bound demand assuming favorable market conditions' },
    { name: 'Pessimistic', type: ScenarioType.PESSIMISTIC, isBaseline: false, color: '#EF4444', sort: 3, desc: 'Lower-bound demand assuming market headwinds' },
  ];

  for (const s of scenarioDefs) {
    await prisma.scenario.upsert({
      where: { tenantId_planVersionId_name: { tenantId: tenant.id, planVersionId: demandPlan.id, name: s.name } },
      update: { description: s.desc, color: s.color, sortOrder: s.sort },
      create: {
        tenantId: tenant.id,
        planVersionId: demandPlan.id,
        name: s.name,
        description: s.desc,
        scenarioType: s.type,
        status: PlanStatus.DRAFT,
        isBaseline: s.isBaseline,
        color: s.color,
        sortOrder: s.sort,
      },
    });
  }
  console.log(`✅ ${scenarioDefs.length} scenarios (Base, Optimistic, Pessimistic)`);

  // ── Summary ──
  console.log('\n' + '┅'.repeat(50));
  console.log('📋 Seed complete:');
  console.log(`   • Tenant:             ${tenant.name} (${seedTenant.tenantSlug})`);
  console.log(`   • Admin:              ${seedTenant.adminEmail}`);
  console.log(`   • UOMs:               ${uomCount}`);
  console.log(`   • Product Categories: ${catCount}`);
  console.log(`   • Time Buckets:       ${timeBucketCount}`);
  console.log(`   • Plan:               ${demandPlan.name}`);
  console.log(`   • Scenarios:          ${scenarioDefs.length}`);
  console.log('\n   Business data (products, actuals, etc.) comes from Marg EDE sync.');
  console.log('┅'.repeat(50));
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
