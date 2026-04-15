import { AccountType, ActualType, ApproverType, BOMStatus, BOMType, CustomerType, DimensionStatus, ForecastModel, JobStatus, LocationType, LotSizingRule, PeriodType, PlanningMethod, PlanStatus, PlanType, PrismaClient, SafetyStockMethod, ScenarioType, SupplyType, UomCategory, UserRole, WorkCenterType, WorkflowEntityType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Keep seed defaults local so db:seed runs in api runtime containers that only ship dist + prisma.
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

function toLegacyCategoryCode(name: string): string {
  const normalizedName = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return (`LEGACY_${normalizedName || 'CATEGORY'}`).slice(0, 50);
}

// Seeded PRNG for consistent random-like values across seed runs
// Uses mulberry32 algorithm for deterministic pseudo-random numbers
function createSeededRandom(seed: number) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Global seeded random function - same seed always produces same sequence
const seededRandom = createSeededRandom(42);

// Helper to generate realistic seasonal data (deterministic)
function generateSeasonalValue(baseValue: number, month: number, growthRate: number = 0.05): number {
  // Seasonal pattern: higher in Q4, lower in Q1
  const seasonalFactors = [0.85, 0.88, 0.95, 1.0, 1.02, 1.05, 1.0, 0.98, 1.05, 1.12, 1.18, 1.25];
  const seasonalFactor = seasonalFactors[month % 12];
  const yearFactor = 1 + (growthRate * Math.floor(month / 12));
  // Use seeded random for consistent values across seed runs
  const randomFactor = 0.95 + seededRandom() * 0.1; // ±5% deterministic variation
  return Math.round(baseValue * seasonalFactor * yearFactor * randomFactor * 100) / 100;
}

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

  return {
    tenantSlug,
    tenantName,
    tenantDomain,
    adminEmail,
    adminPassword,
  };
}

async function main() {
  console.log('🌱 Starting comprehensive database seeding...\n');

  const seedTenant = getSeedTenantConfig();
  const isPublicDomain = !seedTenant.tenantDomain.endsWith('.localhost') && seedTenant.tenantDomain !== 'localhost';
  console.log(`🏢 Seeding tenant context: slug=${seedTenant.tenantSlug}, domain=${seedTenant.tenantDomain}`);

  // Clean existing data for fresh seed
  console.log('🧹 Cleaning existing data...');
  // Clean workflow data first
  await prisma.workflowAction.deleteMany({});
  await prisma.workflowInstance.deleteMany({});
  await prisma.workflowStep.deleteMany({});
  await prisma.workflowTemplate.deleteMany({});
  // Clean manufacturing data (due to FK constraints)
  await prisma.mRPException.deleteMany({});
  await prisma.mRPRequirement.deleteMany({});
  await prisma.plannedOrder.deleteMany({});
  await prisma.mRPRun.deleteMany({});
  await prisma.inventoryLevel.deleteMany({});
  await prisma.inventoryPolicy.deleteMany({});
  await prisma.supplierProduct.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.bOMComponent.deleteMany({});
  await prisma.routingOperation.deleteMany({});
  await prisma.routing.deleteMany({});
  await prisma.billOfMaterial.deleteMany({});
  await prisma.workCenterShift.deleteMany({});
  await prisma.workCenterCapacity.deleteMany({});
  await prisma.workCenter.deleteMany({});
  // Clean forecast data
  await prisma.forecastResult.deleteMany({});
  await prisma.forecastOverride.deleteMany({});
  await prisma.forecastRun.deleteMany({});
  await prisma.forecast.deleteMany({});
  await prisma.actual.deleteMany({});
  await prisma.timeBucket.deleteMany({});
  await prisma.scenario.deleteMany({});
  await prisma.planVersion.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.account.deleteMany({});
  
  // Create primary seeded tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: seedTenant.tenantSlug },
    update: {
      name: seedTenant.tenantName,
      domain: seedTenant.tenantDomain,
      subdomain: seedTenant.tenantSlug,
      status: 'ACTIVE',
      tier: 'PROFESSIONAL',
      timezone: 'America/New_York',
      fiscalYearStart: 1,
      defaultCurrency: 'USD',
      settings: DEFAULT_TENANT_SETTINGS,
    },
    create: {
      name: seedTenant.tenantName,
      slug: seedTenant.tenantSlug,
      domain: seedTenant.tenantDomain,
      subdomain: seedTenant.tenantSlug,
      status: 'ACTIVE',
      tier: 'PROFESSIONAL',
      timezone: 'America/New_York',
      fiscalYearStart: 1,
      defaultCurrency: 'USD',
      settings: DEFAULT_TENANT_SETTINGS,
    },
  });
  console.log(`✅ Created tenant: ${tenant.name}`);

  const domainMappings = [
    { domain: seedTenant.tenantDomain, sslEnabled: isPublicDomain },
  ];

  for (const mapping of domainMappings) {
    await prisma.domainMapping.upsert({
      where: { domain: mapping.domain },
      update: {
        tenantId: tenant.id,
        isVerified: true,
        verifiedAt: new Date(),
        sslEnabled: mapping.sslEnabled,
      },
      create: {
        tenantId: tenant.id,
        domain: mapping.domain,
        isVerified: true,
        verifiedAt: new Date(),
        sslEnabled: mapping.sslEnabled,
      },
    });
  }
  console.log(`✅ Upserted ${domainMappings.length} tenant domain mappings`);

  // Create users
  const adminPassword = await bcrypt.hash(seedTenant.adminPassword, 12);
  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: seedTenant.adminEmail } },
    update: {
      passwordHash: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      tenantId: tenant.id,
      email: seedTenant.adminEmail,
      passwordHash: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`✅ Created admin user: ${adminUser.email}`);

  // ============================================
  // UNIT OF MEASURE MASTER — Standard UOMs
  // ============================================
  await prisma.unitOfMeasure.deleteMany({ where: { tenantId: tenant.id } });
  for (const u of DEFAULT_TENANT_UOMS) {
    await prisma.unitOfMeasure.create({
      data: {
        tenantId: tenant.id,
        code: u.code,
        name: u.name,
        symbol: u.symbol,
        category: u.category as any,
        decimals: u.decimals,
        isBase: u.isBase,
        isActive: true,
        sortOrder: u.sortOrder,
      },
    });
  }
  console.log(`✅ Created ${DEFAULT_TENANT_UOMS.length} units of measure`);

  // ============================================
  // PRODUCT CATEGORIES — Standard categories
  // ============================================
  await prisma.productCategory.deleteMany({ where: { tenantId: tenant.id } });
  for (const c of DEFAULT_PRODUCT_CATEGORIES) {
    await prisma.productCategory.create({
      data: {
        tenantId: tenant.id,
        code: c.code,
        name: c.name,
        description: c.description,
        color: c.color,
        sortOrder: c.sortOrder,
        isActive: true,
      },
    });
  }
  console.log(`✅ Created ${DEFAULT_PRODUCT_CATEGORIES.length} product categories`);

  // ============================================
  // PRODUCTS - Comprehensive product catalog
  // ============================================
  const productData = [
    // Electronics - Finished Goods
    { code: 'ELEC-001', name: 'Laptop Pro 15"', category: 'Electronics', subcategory: 'Laptops', brand: 'TechBrand', listPrice: 1299.99, standardCost: 850 },
    { code: 'ELEC-002', name: 'Laptop Air 13"', category: 'Electronics', subcategory: 'Laptops', brand: 'TechBrand', listPrice: 999.99, standardCost: 650 },
    { code: 'ELEC-003', name: 'Desktop Workstation', category: 'Electronics', subcategory: 'Desktops', brand: 'TechBrand', listPrice: 1899.99, standardCost: 1200 },
    { code: 'ELEC-004', name: 'Monitor 27" 4K', category: 'Electronics', subcategory: 'Displays', brand: 'ViewMax', listPrice: 449.99, standardCost: 280 },
    { code: 'ELEC-005', name: 'Monitor 32" Curved', category: 'Electronics', subcategory: 'Displays', brand: 'ViewMax', listPrice: 599.99, standardCost: 380 },
    // Software
    { code: 'SOFT-001', name: 'Enterprise Suite License', category: 'Software', subcategory: 'Licenses', brand: 'SoftCorp', listPrice: 499.99, standardCost: 50 },
    { code: 'SOFT-002', name: 'Cloud Storage 1TB', category: 'Software', subcategory: 'Cloud', brand: 'CloudMax', listPrice: 99.99, standardCost: 20 },
    { code: 'SOFT-003', name: 'Security Suite', category: 'Software', subcategory: 'Security', brand: 'SecureIT', listPrice: 149.99, standardCost: 30 },
    // Services
    { code: 'SERV-001', name: 'Premium Support', category: 'Services', subcategory: 'Support', brand: 'Demo Company', listPrice: 299.99, standardCost: 150 },
    { code: 'SERV-002', name: 'Installation Service', category: 'Services', subcategory: 'Professional', brand: 'Demo Company', listPrice: 199.99, standardCost: 100 },
    { code: 'SERV-003', name: 'Training Package', category: 'Services', subcategory: 'Training', brand: 'Demo Company', listPrice: 599.99, standardCost: 200 },
    // Accessories
    { code: 'ACC-001', name: 'Wireless Keyboard', category: 'Accessories', subcategory: 'Input', brand: 'TechBrand', listPrice: 79.99, standardCost: 35 },
    { code: 'ACC-002', name: 'Wireless Mouse', category: 'Accessories', subcategory: 'Input', brand: 'TechBrand', listPrice: 49.99, standardCost: 20 },
    { code: 'ACC-003', name: 'USB-C Hub', category: 'Accessories', subcategory: 'Connectivity', brand: 'ConnectPro', listPrice: 89.99, standardCost: 40 },
    { code: 'ACC-004', name: 'Laptop Stand', category: 'Accessories', subcategory: 'Ergonomics', brand: 'ErgoDesk', listPrice: 69.99, standardCost: 30 },
    // ============================================
    // RAW MATERIALS / COMPONENTS for Manufacturing
    // ============================================
    // Laptop Components
    { code: 'COMP-CPU-I7', name: 'Intel Core i7 Processor', category: 'Components', subcategory: 'Processors', brand: 'Intel', listPrice: 350.00, standardCost: 280 },
    { code: 'COMP-CPU-I5', name: 'Intel Core i5 Processor', category: 'Components', subcategory: 'Processors', brand: 'Intel', listPrice: 250.00, standardCost: 200 },
    { code: 'COMP-RAM-16', name: '16GB DDR5 RAM', category: 'Components', subcategory: 'Memory', brand: 'Kingston', listPrice: 80.00, standardCost: 55 },
    { code: 'COMP-RAM-8', name: '8GB DDR5 RAM', category: 'Components', subcategory: 'Memory', brand: 'Kingston', listPrice: 45.00, standardCost: 30 },
    { code: 'COMP-SSD-512', name: '512GB NVMe SSD', category: 'Components', subcategory: 'Storage', brand: 'Samsung', listPrice: 75.00, standardCost: 50 },
    { code: 'COMP-SSD-256', name: '256GB NVMe SSD', category: 'Components', subcategory: 'Storage', brand: 'Samsung', listPrice: 45.00, standardCost: 30 },
    { code: 'COMP-MB-STD', name: 'Standard Motherboard', category: 'Components', subcategory: 'Boards', brand: 'TechBrand', listPrice: 120.00, standardCost: 80 },
    { code: 'COMP-MB-PRO', name: 'Pro Motherboard', category: 'Components', subcategory: 'Boards', brand: 'TechBrand', listPrice: 180.00, standardCost: 120 },
    { code: 'COMP-LCD-15', name: '15.6" LCD Panel', category: 'Components', subcategory: 'Displays', brand: 'LG', listPrice: 150.00, standardCost: 100 },
    { code: 'COMP-LCD-13', name: '13.3" LCD Panel', category: 'Components', subcategory: 'Displays', brand: 'LG', listPrice: 120.00, standardCost: 80 },
    { code: 'COMP-LCD-27', name: '27" 4K LCD Panel', category: 'Components', subcategory: 'Displays', brand: 'LG', listPrice: 200.00, standardCost: 140 },
    { code: 'COMP-LCD-32', name: '32" Curved LCD Panel', category: 'Components', subcategory: 'Displays', brand: 'LG', listPrice: 280.00, standardCost: 200 },
    { code: 'COMP-BATT', name: 'Lithium Battery Pack', category: 'Components', subcategory: 'Power', brand: 'PowerCell', listPrice: 65.00, standardCost: 45 },
    { code: 'COMP-PSU', name: 'Power Supply Unit', category: 'Components', subcategory: 'Power', brand: 'PowerCell', listPrice: 85.00, standardCost: 55 },
    { code: 'COMP-CASE-L', name: 'Laptop Chassis', category: 'Components', subcategory: 'Enclosures', brand: 'TechBrand', listPrice: 45.00, standardCost: 25 },
    { code: 'COMP-CASE-D', name: 'Desktop Tower Case', category: 'Components', subcategory: 'Enclosures', brand: 'TechBrand', listPrice: 60.00, standardCost: 35 },
    { code: 'COMP-CASE-M', name: 'Monitor Stand/Case', category: 'Components', subcategory: 'Enclosures', brand: 'ViewMax', listPrice: 30.00, standardCost: 18 },
    { code: 'COMP-KB', name: 'Laptop Keyboard Module', category: 'Components', subcategory: 'Input', brand: 'TechBrand', listPrice: 25.00, standardCost: 15 },
    { code: 'COMP-GPU', name: 'Integrated Graphics Card', category: 'Components', subcategory: 'Graphics', brand: 'NVIDIA', listPrice: 200.00, standardCost: 140 },
    { code: 'COMP-GPU-PRO', name: 'Dedicated Graphics Card', category: 'Components', subcategory: 'Graphics', brand: 'NVIDIA', listPrice: 450.00, standardCost: 320 },
    // Packaging Materials
    { code: 'PKG-BOX-L', name: 'Laptop Packaging Box', category: 'Packaging', subcategory: 'Boxes', brand: 'PackCorp', listPrice: 8.00, standardCost: 4 },
    { code: 'PKG-BOX-D', name: 'Desktop Packaging Box', category: 'Packaging', subcategory: 'Boxes', brand: 'PackCorp', listPrice: 12.00, standardCost: 6 },
    { code: 'PKG-BOX-M', name: 'Monitor Packaging Box', category: 'Packaging', subcategory: 'Boxes', brand: 'PackCorp', listPrice: 10.00, standardCost: 5 },
    { code: 'PKG-FOAM', name: 'Protective Foam Insert', category: 'Packaging', subcategory: 'Protection', brand: 'PackCorp', listPrice: 3.00, standardCost: 1.50 },
    { code: 'PKG-MANUAL', name: 'User Manual', category: 'Packaging', subcategory: 'Documentation', brand: 'TechBrand', listPrice: 1.00, standardCost: 0.50 },
    { code: 'PKG-CABLE', name: 'Power Cable', category: 'Packaging', subcategory: 'Accessories', brand: 'Generic', listPrice: 5.00, standardCost: 2.50 },
  ];

  const products: any[] = [];
  const extraProductCategories = [...new Set(productData.map((product) => product.category.trim()))]
    .filter((categoryName) => !DEFAULT_PRODUCT_CATEGORIES.some((category) => category.name.toLowerCase() === categoryName.toLowerCase()))
    .map((categoryName, index) => ({
      tenantId: tenant.id,
      code: `${toLegacyCategoryCode(categoryName)}_${String(index + 1).padStart(2, '0')}`.slice(0, 50),
      name: categoryName,
      description: `Migrated legacy product category for ${categoryName}`,
      sortOrder: DEFAULT_PRODUCT_CATEGORIES.length + index + 1,
      isActive: true,
    }));

  if (extraProductCategories.length > 0) {
    await prisma.productCategory.createMany({
      data: extraProductCategories,
      skipDuplicates: true,
    });
  }

  const productCategories = await prisma.productCategory.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const productCategoryByName = new Map(
    productCategories.map((category) => [category.name.toLowerCase(), category]),
  );

  const eachUom = await prisma.unitOfMeasure.findFirst({
    where: { tenantId: tenant.id, code: 'EA' },
    select: { id: true, code: true },
  });

  if (!eachUom) {
    throw new Error('Missing default EA unit of measure during seed');
  }

  for (const p of productData) {
    const category = productCategoryByName.get(p.category.toLowerCase());
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        code: p.code,
        name: p.name,
        category: category?.name ?? p.category,
        categoryId: category?.id,
        subcategory: p.subcategory,
        brand: p.brand,
        listPrice: p.listPrice,
        standardCost: p.standardCost,
        unitOfMeasure: eachUom.code,
        unitOfMeasureId: eachUom.id,
        status: 'ACTIVE',
      },
    });
    products.push(product);
  }
  console.log(`✅ Created ${products.length} products`);

  // ============================================
  // LOCATIONS - Multiple regions and types
  // ============================================
  const locationData = [
    { code: 'NA-EAST-WH', name: 'East Coast Warehouse', region: 'North America', country: 'USA', city: 'New Jersey', type: LocationType.WAREHOUSE },
    { code: 'NA-WEST-WH', name: 'West Coast Warehouse', region: 'North America', country: 'USA', city: 'Los Angeles', type: LocationType.WAREHOUSE },
    { code: 'NA-CENTRAL-DC', name: 'Central Distribution', region: 'North America', country: 'USA', city: 'Chicago', type: LocationType.DISTRIBUTION_CENTER },
    { code: 'NA-NYC-STORE', name: 'NYC Flagship Store', region: 'North America', country: 'USA', city: 'New York', type: LocationType.STORE },
    { code: 'NA-SF-STORE', name: 'San Francisco Store', region: 'North America', country: 'USA', city: 'San Francisco', type: LocationType.STORE },
    { code: 'EU-UK-WH', name: 'UK Warehouse', region: 'Europe', country: 'UK', city: 'London', type: LocationType.WAREHOUSE },
    { code: 'EU-DE-DC', name: 'Germany Distribution', region: 'Europe', country: 'Germany', city: 'Frankfurt', type: LocationType.DISTRIBUTION_CENTER },
    { code: 'APAC-SG-WH', name: 'Singapore Hub', region: 'Asia Pacific', country: 'Singapore', city: 'Singapore', type: LocationType.WAREHOUSE },
    { code: 'APAC-JP-STORE', name: 'Tokyo Store', region: 'Asia Pacific', country: 'Japan', city: 'Tokyo', type: LocationType.STORE },
  ];

  const locations: any[] = [];
  for (const l of locationData) {
    const location = await prisma.location.create({
      data: {
        tenantId: tenant.id,
        code: l.code,
        name: l.name,
        region: l.region,
        country: l.country,
        city: l.city,
        type: l.type,
        status: 'ACTIVE',
      },
    });
    locations.push(location);
  }
  console.log(`✅ Created ${locations.length} locations`);

  // ============================================
  // CUSTOMERS - Various segments and types
  // ============================================
  const customerData = [
    { code: 'CUST-ENT-001', name: 'Global Tech Corp', segment: 'Enterprise', industry: 'Technology', type: CustomerType.DIRECT, country: 'USA' },
    { code: 'CUST-ENT-002', name: 'Financial Services Inc', segment: 'Enterprise', industry: 'Finance', type: CustomerType.DIRECT, country: 'USA' },
    { code: 'CUST-ENT-003', name: 'Healthcare Systems', segment: 'Enterprise', industry: 'Healthcare', type: CustomerType.DIRECT, country: 'USA' },
    { code: 'CUST-MID-001', name: 'Regional Manufacturing', segment: 'Mid-Market', industry: 'Manufacturing', type: CustomerType.DISTRIBUTOR, country: 'USA' },
    { code: 'CUST-MID-002', name: 'Retail Chain Partners', segment: 'Mid-Market', industry: 'Retail', type: CustomerType.RETAILER, country: 'USA' },
    { code: 'CUST-MID-003', name: 'Education Solutions', segment: 'Mid-Market', industry: 'Education', type: CustomerType.DIRECT, country: 'UK' },
    { code: 'CUST-SMB-001', name: 'Local Business Group', segment: 'SMB', industry: 'Professional Services', type: CustomerType.DIRECT, country: 'USA' },
    { code: 'CUST-SMB-002', name: 'Startup Ventures', segment: 'SMB', industry: 'Technology', type: CustomerType.DIRECT, country: 'Germany' },
    { code: 'CUST-ECOM-001', name: 'Online Marketplace', segment: 'E-Commerce', industry: 'E-Commerce', type: CustomerType.ECOMMERCE, country: 'Global' },
    { code: 'CUST-WHOLE-001', name: 'Wholesale Distributors', segment: 'Wholesale', industry: 'Distribution', type: CustomerType.WHOLESALE, country: 'USA' },
  ];

  const customers: any[] = [];
  for (const c of customerData) {
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        code: c.code,
        name: c.name,
        segment: c.segment,
        industry: c.industry,
        type: c.type,
        country: c.country,
        status: 'ACTIVE',
      },
    });
    customers.push(customer);
  }
  console.log(`✅ Created ${customers.length} customers`);

  // ============================================
  // ACCOUNTS - Chart of accounts
  // ============================================
  const accountData = [
    { code: '4000', name: 'Total Revenue', type: AccountType.REVENUE, category: 'Revenue' },
    { code: '4100', name: 'Product Revenue', type: AccountType.REVENUE, category: 'Revenue' },
    { code: '4200', name: 'Service Revenue', type: AccountType.REVENUE, category: 'Revenue' },
    { code: '4300', name: 'Software License Revenue', type: AccountType.REVENUE, category: 'Revenue' },
    { code: '5000', name: 'Total Cost of Sales', type: AccountType.COST_OF_GOODS, category: 'Cost of Sales' },
    { code: '5100', name: 'Product COGS', type: AccountType.COST_OF_GOODS, category: 'Cost of Sales' },
    { code: '5200', name: 'Service Delivery Cost', type: AccountType.COST_OF_GOODS, category: 'Cost of Sales' },
    { code: '6000', name: 'Operating Expenses', type: AccountType.OPERATING_EXPENSE, category: 'OpEx' },
    { code: '6100', name: 'Sales & Marketing', type: AccountType.OPERATING_EXPENSE, category: 'OpEx' },
    { code: '6200', name: 'R&D Expenses', type: AccountType.OPERATING_EXPENSE, category: 'OpEx' },
    { code: '6300', name: 'G&A Expenses', type: AccountType.OPERATING_EXPENSE, category: 'OpEx' },
  ];

  const accounts: any[] = [];
  for (const a of accountData) {
    const account = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        code: a.code,
        name: a.name,
        type: a.type,
        category: a.category,
        status: 'ACTIVE',
      },
    });
    accounts.push(account);
  }
  console.log(`✅ Created ${accounts.length} accounts`);

  // ============================================
  // HISTORICAL ACTUALS - 24 months of data
  // ============================================
  console.log('📊 Generating 24 months of historical actuals...');
  let actualsCount = 0;
  
  // Base values for each product (annual revenue potential)
  const productBaseValues: Record<string, number> = {
    'ELEC-001': 50000, 'ELEC-002': 40000, 'ELEC-003': 30000, 'ELEC-004': 25000, 'ELEC-005': 20000,
    'SOFT-001': 35000, 'SOFT-002': 15000, 'SOFT-003': 12000,
    'SERV-001': 20000, 'SERV-002': 15000, 'SERV-003': 18000,
    'ACC-001': 8000, 'ACC-002': 6000, 'ACC-003': 10000, 'ACC-004': 5000,
  };

  const revenueAccountId = accounts.find(a => a.code === '4100')?.id;

  // Generate actuals for past 24 months
  const actualsBatch: any[] = [];
  for (let monthOffset = -24; monthOffset < 0; monthOffset++) {
    const periodDate = new Date();
    periodDate.setMonth(periodDate.getMonth() + monthOffset);
    periodDate.setDate(1);
    periodDate.setHours(0, 0, 0, 0);

    const monthIndex = (periodDate.getMonth() + 24) % 12; // Ensure positive

    for (const product of products) {
      // Select 3-4 locations for each product-month (deterministic selection)
      const locCount = 3 + Math.floor(seededRandom() * 2);
      const selectedLocations = locations.slice(0, locCount);
      
      for (const location of selectedLocations) {
        // Select 2-3 customers (deterministic selection)
        const custCount = 2 + Math.floor(seededRandom() * 2);
        const selectedCustomers = customers.slice(0, custCount);
        
        for (const customer of selectedCustomers) {
          const baseValue = (productBaseValues[product.code] || 10000) / 12 / 3 / 2; // Divide by months, locations, customers
          const amount = generateSeasonalValue(baseValue, monthIndex + (monthOffset + 24));
          const quantity = Math.max(1, Math.floor(amount / (product.listPrice || 100)));

          actualsBatch.push({
            tenantId: tenant.id,
            actualType: ActualType.SALES,
            periodDate: periodDate,
            periodType: PeriodType.MONTHLY,
            productId: product.id,
            locationId: location.id,
            customerId: customer.id,
            accountId: revenueAccountId,
            quantity: quantity,
            amount: amount,
            currency: 'USD',
            sourceSystem: 'ERP',
          });
          actualsCount++;
        }
      }
    }
  }
  await prisma.actual.createMany({ data: actualsBatch });
  console.log(`✅ Created ${actualsCount} historical actual records`);

  // ============================================
  // PLANS - Multiple planning cycles
  // ============================================
  
  // Plan 1: FY2025 Annual Budget (Approved)
  const plan2025 = await prisma.planVersion.create({
    data: {
      tenantId: tenant.id,
      name: 'FY2025 Annual Budget',
      description: 'Annual operating budget for fiscal year 2025 with growth targets',
      planType: PlanType.BUDGET,
      status: PlanStatus.APPROVED,
      version: 1,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      periodType: PeriodType.MONTHLY,
      createdById: adminUser.id,
      settings: { growthTarget: 0.15, marginTarget: 0.35 },
    },
  });
  console.log(`✅ Created plan: ${plan2025.name}`);

  // Plan 2: FY2026 Strategic Plan (Draft)
  const plan2026 = await prisma.planVersion.create({
    data: {
      tenantId: tenant.id,
      name: 'FY2026 Strategic Plan',
      description: 'Strategic 3-year plan starting FY2026',
      planType: PlanType.FORECAST,
      status: PlanStatus.DRAFT,
      version: 1,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      periodType: PeriodType.MONTHLY,
      createdById: adminUser.id,
      settings: { growthTarget: 0.20, marginTarget: 0.40 },
    },
  });
  console.log(`✅ Created plan: ${plan2026.name}`);

  // Plan 3: Q1 2026 What-If Analysis (In Review)
  const planQ1 = await prisma.planVersion.create({
    data: {
      tenantId: tenant.id,
      name: 'Q1 2026 What-If Analysis',
      description: 'Quarterly what-if scenario analysis',
      planType: PlanType.WHAT_IF,
      status: PlanStatus.IN_REVIEW,
      version: 1,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-31'),
      periodType: PeriodType.MONTHLY,
      createdById: adminUser.id,
      settings: {},
    },
  });
  console.log(`✅ Created plan: ${planQ1.name}`);

  // ============================================
  // SCENARIOS - Multiple scenarios per plan
  // ============================================
  
  // Scenarios for FY2025 Plan
  const scenario2025Base = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan2025.id,
      name: 'Baseline',
      description: 'Base case scenario with 15% YoY growth',
      scenarioType: ScenarioType.BASE,
      isBaseline: true,
    },
  });

  const scenario2025Optimistic = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan2025.id,
      name: 'Optimistic',
      description: 'Best case with 25% growth and market expansion',
      scenarioType: ScenarioType.OPTIMISTIC,
      isBaseline: false,
    },
  });

  const scenario2025Conservative = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan2025.id,
      name: 'Conservative',
      description: 'Conservative case with 8% growth',
      scenarioType: ScenarioType.PESSIMISTIC,
      isBaseline: false,
    },
  });

  // Scenarios for FY2026 Plan
  const scenario2026Base = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan2026.id,
      name: 'Growth Plan',
      description: 'Aggressive growth strategy with new markets',
      scenarioType: ScenarioType.BASE,
      isBaseline: true,
    },
  });

  const scenario2026WhatIf = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: plan2026.id,
      name: 'Market Downturn',
      description: 'Scenario for economic downturn',
      scenarioType: ScenarioType.PESSIMISTIC,
      isBaseline: false,
    },
  });

  // Scenario for Q1 Rolling Forecast
  const scenarioQ1 = await prisma.scenario.create({
    data: {
      tenantId: tenant.id,
      planVersionId: planQ1.id,
      name: 'Latest Estimate',
      description: 'Latest estimate based on January actuals',
      scenarioType: ScenarioType.BASE,
      isBaseline: true,
    },
  });

  console.log(`✅ Created 6 scenarios across all plans`);

  // ============================================
  // FORECASTS - Generate forecasts for all scenarios with MULTIPLE MODELS
  // ============================================
  console.log('📈 Generating forecasts for all scenarios with multiple models...');
  let forecastCount = 0;

  // Define forecast models to create (for model comparison feature)
  const forecastModels = [
    { model: ForecastModel.HOLT_WINTERS, variance: 1.0 },
    { model: ForecastModel.MOVING_AVERAGE, variance: 0.92 },
    { model: ForecastModel.LINEAR_REGRESSION, variance: 1.05 },
    { model: ForecastModel.AI_HYBRID, variance: 1.02 },
  ];

  const allScenarios = [
    { scenario: scenario2025Base, plan: plan2025, growthRate: 0.15 },
    { scenario: scenario2025Optimistic, plan: plan2025, growthRate: 0.25 },
    { scenario: scenario2025Conservative, plan: plan2025, growthRate: 0.08 },
    { scenario: scenario2026Base, plan: plan2026, growthRate: 0.20 },
    { scenario: scenario2026WhatIf, plan: plan2026, growthRate: -0.05 },
    { scenario: scenarioQ1, plan: planQ1, growthRate: 0.12 },
  ];

  for (const { scenario, plan, growthRate } of allScenarios) {
    const startDate = new Date(plan.startDate);
    const endDate = new Date(plan.endDate);
    const forecastBatch: any[] = [];

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const monthIndex = currentDate.getMonth();

      for (const product of products.slice(0, 8)) {
        for (const location of locations.slice(0, 4)) {
          const baseValue = (productBaseValues[product.code] || 10000) / 12 / 4;

          for (const { model, variance } of forecastModels) {
            const amount = generateSeasonalValue(baseValue * (1 + growthRate) * variance, monthIndex);
            const quantity = Math.max(1, Math.floor(amount / (product.listPrice || 100)));

            forecastBatch.push({
              tenantId: tenant.id,
              planVersionId: plan.id,
              scenarioId: scenario.id,
              productId: product.id,
              locationId: location.id,
              accountId: revenueAccountId,
              periodDate: new Date(currentDate),
              periodType: PeriodType.MONTHLY,
              forecastQuantity: quantity,
              forecastAmount: amount,
              currency: 'USD',
              forecastModel: model,
              confidenceLevel: model === ForecastModel.AI_HYBRID ? 90 : 85,
              createdById: adminUser.id,
            });
            forecastCount++;
          }
        }
      }

      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    await prisma.forecast.createMany({ data: forecastBatch });
  }
  console.log(`✅ Created ${forecastCount} forecast records`);

  // ============================================
  // TIME BUCKETS - All period types for 2024-2027
  // ============================================
  console.log('📅 Generating time buckets...');
  let timeBucketCount = 0;
  const freezeCutoff = new Date();
  freezeCutoff.setMonth(freezeCutoff.getMonth() - 3);
  freezeCutoff.setDate(1);
  freezeCutoff.setHours(0, 0, 0, 0);

  for (let year = 2024; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      const bucketStart = new Date(year, month, 1);
      const bucketEnd = new Date(year, month + 1, 0);
      const periodKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      await prisma.timeBucket.create({
        data: {
          tenantId: tenant.id,
          periodType: PeriodType.MONTHLY,
          periodKey,
          bucketStart,
          bucketEnd,
          fiscalYear: year,
          fiscalQuarter: Math.floor(month / 3) + 1,
          fiscalMonth: month + 1,
          isFrozen: bucketStart < freezeCutoff,
        },
      });
      timeBucketCount++;
    }

    for (let q = 0; q < 4; q++) {
      const bucketStart = new Date(year, q * 3, 1);
      const bucketEnd = new Date(year, q * 3 + 3, 0);
      await prisma.timeBucket.create({
        data: {
          tenantId: tenant.id,
          periodType: PeriodType.QUARTERLY,
          periodKey: `${year}-Q${q + 1}`,
          bucketStart,
          bucketEnd,
          fiscalYear: year,
          fiscalQuarter: q + 1,
          isFrozen: bucketStart < freezeCutoff,
        },
      });
      timeBucketCount++;
    }

    await prisma.timeBucket.create({
      data: {
        tenantId: tenant.id,
        periodType: PeriodType.YEARLY,
        periodKey: `${year}`,
        bucketStart: new Date(year, 0, 1),
        bucketEnd: new Date(year, 11, 31),
        fiscalYear: year,
        isFrozen: new Date(year, 0, 1) < freezeCutoff,
      },
    });
    timeBucketCount++;

    let weekDate = new Date(year, 0, 1);
    while (weekDate.getDay() !== 1) {
      weekDate.setDate(weekDate.getDate() + 1);
    }
    while (weekDate.getFullYear() === year) {
      const weekEnd = new Date(weekDate);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekNum = Math.ceil(
        ((weekDate.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7,
      );
      await prisma.timeBucket.create({
        data: {
          tenantId: tenant.id,
          periodType: PeriodType.WEEKLY,
          periodKey: `${year}-W${String(weekNum).padStart(2, '0')}`,
          bucketStart: new Date(weekDate),
          bucketEnd: weekEnd.getFullYear() === year ? weekEnd : new Date(year, 11, 31),
          fiscalYear: year,
          fiscalWeek: weekNum,
          isFrozen: weekDate < freezeCutoff,
        },
      });
      timeBucketCount++;
      weekDate.setDate(weekDate.getDate() + 7);
    }
  }
  console.log(`✅ Created ${timeBucketCount} time buckets`);

  // ============================================
  // FORECAST RUNS + RESULTS - Completed runs for accuracy metrics
  // ============================================
  console.log('🔬 Generating forecast runs and results...');
  let runCount = 0;
  let resultCount = 0;

  // Create a completed forecast run for each scenario with Holt-Winters model
  for (const { scenario, plan, growthRate } of allScenarios) {
    const startDate = new Date(plan.startDate);
    const endDate = new Date(plan.endDate);

    const forecastRun = await prisma.forecastRun.create({
      data: {
        tenantId: tenant.id,
        planVersionId: plan.id,
        scenarioId: scenario.id,
        forecastModel: ForecastModel.HOLT_WINTERS,
        modelVersion: '1.0.0',
        isPersistent: true,
        status: JobStatus.COMPLETED,
        parameters: { alpha: 0.3, beta: 0.1, gamma: 0.2, seasonalPeriod: 12 },
        inputSnapshot: { products: products.slice(0, 8).map(p => p.id), locations: locations.slice(0, 4).map(l => l.id) },
        startPeriod: startDate,
        endPeriod: endDate,
        requestedById: adminUser.id,
        startedAt: new Date(Date.now() - 3600000),
        completedAt: new Date(Date.now() - 3500000),
      },
    });
    runCount++;

    // Generate forecast results for this run in a batch
    const resultBatch: any[] = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const monthIndex = currentDate.getMonth();
      for (const product of products.slice(0, 8)) {
        for (const location of locations.slice(0, 4)) {
          const baseValue = (productBaseValues[product.code] || 10000) / 12 / 4;
          const amount = generateSeasonalValue(baseValue * (1 + growthRate), monthIndex);
          const quantity = Math.max(1, Math.floor(amount / (product.listPrice || 100)));

          resultBatch.push({
            tenantId: tenant.id,
            forecastRunId: forecastRun.id,
            periodDate: new Date(currentDate),
            periodType: PeriodType.MONTHLY,
            productId: product.id,
            locationId: location.id,
            accountId: revenueAccountId,
            forecastQuantity: quantity,
            forecastAmount: amount,
            currency: 'USD',
            confidenceLevel: 85,
            confidenceLower: amount * 0.85,
            confidenceUpper: amount * 1.15,
          });
          resultCount++;
        }
      }
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    await prisma.forecastResult.createMany({ data: resultBatch });
  }
  console.log(`✅ Created ${runCount} forecast runs with ${resultCount} results`);

  // ============================================
  // MANUFACTURING DATA
  // ============================================
  console.log('\n🏭 Seeding Manufacturing Data...\n');

  // Helper to find product by code
  const getProduct = (code: string) => products.find(p => p.code === code);
  const getLocation = (code: string) => locations.find(l => l.code === code);

  // ============================================
  // WORK CENTERS - Production equipment and labor pools
  // ============================================
  const workCenterData = [
    { code: 'WC-SMT-01', name: 'SMT Assembly Line 1', type: WorkCenterType.MACHINE, costPerHour: 150, efficiency: 95, description: 'Surface mount technology for PCB assembly' },
    { code: 'WC-SMT-02', name: 'SMT Assembly Line 2', type: WorkCenterType.MACHINE, costPerHour: 150, efficiency: 92, description: 'Surface mount technology backup line' },
    { code: 'WC-ASSY-01', name: 'Final Assembly Station 1', type: WorkCenterType.MIXED, costPerHour: 80, efficiency: 90, description: 'Final product assembly with manual workers' },
    { code: 'WC-ASSY-02', name: 'Final Assembly Station 2', type: WorkCenterType.MIXED, costPerHour: 80, efficiency: 88, description: 'Final product assembly backup' },
    { code: 'WC-TEST-01', name: 'Quality Testing Station', type: WorkCenterType.MACHINE, costPerHour: 100, efficiency: 98, description: 'Automated testing and QA' },
    { code: 'WC-PACK-01', name: 'Packaging Line 1', type: WorkCenterType.LABOR, costPerHour: 45, efficiency: 95, description: 'Product packaging and boxing' },
    { code: 'WC-BURN-01', name: 'Burn-in Testing', type: WorkCenterType.MACHINE, costPerHour: 60, efficiency: 99, description: '48-hour burn-in testing chamber' },
    { code: 'WC-LCD-01', name: 'LCD Assembly Line', type: WorkCenterType.MACHINE, costPerHour: 120, efficiency: 94, description: 'Monitor panel assembly' },
  ];

  const workCenters: any[] = [];
  const eastWarehouse = getLocation('NA-EAST-WH');
  
  for (const wc of workCenterData) {
    const workCenter = await prisma.workCenter.create({
      data: {
        tenantId: tenant.id,
        code: wc.code,
        name: wc.name,
        type: wc.type,
        description: wc.description,
        locationId: eastWarehouse?.id,
        costPerHour: wc.costPerHour,
        efficiency: wc.efficiency,
        utilization: 85,
        status: DimensionStatus.ACTIVE,
      },
    });
    workCenters.push(workCenter);

    // Add capacity for each work center
    await prisma.workCenterCapacity.create({
      data: {
        workCenterId: workCenter.id,
        effectiveFrom: new Date('2024-01-01'),
        capacityPerDay: wc.type === WorkCenterType.MACHINE ? 480 : 240, // 8 hours * 60 min for machines, less for labor
        capacityUOM: 'MIN',
        numberOfMachines: wc.type === WorkCenterType.MACHINE ? 2 : 1,
        numberOfShifts: 2,
        hoursPerShift: 8,
      },
    });

    // Add shifts for each work center
    await prisma.workCenterShift.createMany({
      data: [
        { workCenterId: workCenter.id, shiftName: 'Day Shift', startTime: '06:00:00', endTime: '14:00:00', daysOfWeek: [1, 2, 3, 4, 5], breakMinutes: 30, isActive: true },
        { workCenterId: workCenter.id, shiftName: 'Evening Shift', startTime: '14:00:00', endTime: '22:00:00', daysOfWeek: [1, 2, 3, 4, 5], breakMinutes: 30, isActive: true },
      ],
    });
  }
  console.log(`✅ Created ${workCenters.length} work centers with capacities and shifts`);

  // ============================================
  // SUPPLIERS - Component vendors
  // ============================================
  const supplierData = [
    { code: 'SUP-INTEL', name: 'Intel Corporation', country: 'USA', currency: 'USD', leadTime: 14, qualityRating: 4.8, onTimeRate: 96 },
    { code: 'SUP-SAMSUNG', name: 'Samsung Electronics', country: 'South Korea', currency: 'USD', leadTime: 21, qualityRating: 4.7, onTimeRate: 94 },
    { code: 'SUP-KINGSTON', name: 'Kingston Technology', country: 'USA', currency: 'USD', leadTime: 7, qualityRating: 4.5, onTimeRate: 98 },
    { code: 'SUP-LG', name: 'LG Display', country: 'South Korea', currency: 'USD', leadTime: 28, qualityRating: 4.6, onTimeRate: 92 },
    { code: 'SUP-NVIDIA', name: 'NVIDIA Corporation', country: 'USA', currency: 'USD', leadTime: 21, qualityRating: 4.9, onTimeRate: 95 },
    { code: 'SUP-POWER', name: 'PowerCell Industries', country: 'China', currency: 'USD', leadTime: 35, qualityRating: 4.3, onTimeRate: 88 },
    { code: 'SUP-PACK', name: 'PackCorp Solutions', country: 'Mexico', currency: 'USD', leadTime: 5, qualityRating: 4.2, onTimeRate: 99 },
    { code: 'SUP-GENERIC', name: 'Generic Parts Co', country: 'China', currency: 'USD', leadTime: 45, qualityRating: 4.0, onTimeRate: 85 },
  ];

  const suppliers: any[] = [];
  for (const sup of supplierData) {
    const supplier = await prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        code: sup.code,
        name: sup.name,
        country: sup.country,
        currency: sup.currency,
        qualityRating: sup.qualityRating,
        onTimeDeliveryRate: sup.onTimeRate,
        status: DimensionStatus.ACTIVE,
        contactName: `${sup.name} Sales`,
        email: `sales@${sup.code.toLowerCase().replace('sup-', '')}.com`,
        paymentTerms: 'NET30',
      },
    });
    suppliers.push(supplier);
  }
  console.log(`✅ Created ${suppliers.length} suppliers`);

  // ============================================
  // SUPPLIER PRODUCTS - What each supplier provides
  // ============================================
  const getSupplier = (code: string) => suppliers.find(s => s.code === code);
  
  const supplierProductMappings = [
    // Intel supplies processors
    { supplierCode: 'SUP-INTEL', productCode: 'COMP-CPU-I7', price: 280, leadTime: 14, isPrimary: true },
    { supplierCode: 'SUP-INTEL', productCode: 'COMP-CPU-I5', price: 200, leadTime: 14, isPrimary: true },
    // Samsung supplies SSDs
    { supplierCode: 'SUP-SAMSUNG', productCode: 'COMP-SSD-512', price: 50, leadTime: 21, isPrimary: true },
    { supplierCode: 'SUP-SAMSUNG', productCode: 'COMP-SSD-256', price: 30, leadTime: 21, isPrimary: true },
    // Kingston supplies RAM
    { supplierCode: 'SUP-KINGSTON', productCode: 'COMP-RAM-16', price: 55, leadTime: 7, isPrimary: true },
    { supplierCode: 'SUP-KINGSTON', productCode: 'COMP-RAM-8', price: 30, leadTime: 7, isPrimary: true },
    // LG supplies displays
    { supplierCode: 'SUP-LG', productCode: 'COMP-LCD-15', price: 100, leadTime: 28, isPrimary: true },
    { supplierCode: 'SUP-LG', productCode: 'COMP-LCD-13', price: 80, leadTime: 28, isPrimary: true },
    { supplierCode: 'SUP-LG', productCode: 'COMP-LCD-27', price: 140, leadTime: 28, isPrimary: true },
    { supplierCode: 'SUP-LG', productCode: 'COMP-LCD-32', price: 200, leadTime: 28, isPrimary: true },
    // NVIDIA supplies GPUs
    { supplierCode: 'SUP-NVIDIA', productCode: 'COMP-GPU', price: 140, leadTime: 21, isPrimary: true },
    { supplierCode: 'SUP-NVIDIA', productCode: 'COMP-GPU-PRO', price: 320, leadTime: 21, isPrimary: true },
    // PowerCell supplies batteries and PSUs
    { supplierCode: 'SUP-POWER', productCode: 'COMP-BATT', price: 45, leadTime: 35, isPrimary: true },
    { supplierCode: 'SUP-POWER', productCode: 'COMP-PSU', price: 55, leadTime: 35, isPrimary: true },
    // PackCorp supplies packaging
    { supplierCode: 'SUP-PACK', productCode: 'PKG-BOX-L', price: 4, leadTime: 5, isPrimary: true },
    { supplierCode: 'SUP-PACK', productCode: 'PKG-BOX-D', price: 6, leadTime: 5, isPrimary: true },
    { supplierCode: 'SUP-PACK', productCode: 'PKG-BOX-M', price: 5, leadTime: 5, isPrimary: true },
    { supplierCode: 'SUP-PACK', productCode: 'PKG-FOAM', price: 1.50, leadTime: 5, isPrimary: true },
    // Generic supplies misc items
    { supplierCode: 'SUP-GENERIC', productCode: 'COMP-MB-STD', price: 80, leadTime: 45, isPrimary: true },
    { supplierCode: 'SUP-GENERIC', productCode: 'COMP-MB-PRO', price: 120, leadTime: 45, isPrimary: true },
    { supplierCode: 'SUP-GENERIC', productCode: 'COMP-CASE-L', price: 25, leadTime: 30, isPrimary: true },
    { supplierCode: 'SUP-GENERIC', productCode: 'COMP-CASE-D', price: 35, leadTime: 30, isPrimary: true },
    { supplierCode: 'SUP-GENERIC', productCode: 'COMP-CASE-M', price: 18, leadTime: 30, isPrimary: true },
    { supplierCode: 'SUP-GENERIC', productCode: 'COMP-KB', price: 15, leadTime: 21, isPrimary: true },
    { supplierCode: 'SUP-GENERIC', productCode: 'PKG-MANUAL', price: 0.50, leadTime: 7, isPrimary: true },
    { supplierCode: 'SUP-GENERIC', productCode: 'PKG-CABLE', price: 2.50, leadTime: 7, isPrimary: true },
  ];

  let supplierProductCount = 0;
  for (const sp of supplierProductMappings) {
    const supplier = getSupplier(sp.supplierCode);
    const product = getProduct(sp.productCode);
    if (supplier && product) {
      await prisma.supplierProduct.create({
        data: {
          supplierId: supplier.id,
          productId: product.id,
          unitPrice: sp.price,
          leadTimeDays: sp.leadTime,
          minOrderQty: 10,
          orderMultiple: 5,
          isPrimary: sp.isPrimary,
          priority: 1,
          effectiveFrom: new Date('2024-01-01'),
        },
      });
      supplierProductCount++;
    }
  }
  console.log(`✅ Created ${supplierProductCount} supplier-product relationships`);

  // ============================================
  // BILLS OF MATERIAL - Product structures
  // ============================================
  const laptopPro = getProduct('ELEC-001');
  const laptopAir = getProduct('ELEC-002');
  const desktop = getProduct('ELEC-003');
  const monitor27 = getProduct('ELEC-004');
  const monitor32 = getProduct('ELEC-005');

  const boms: any[] = [];

  // BOM for Laptop Pro 15"
  if (laptopPro) {
    const bomLaptopPro = await prisma.billOfMaterial.create({
      data: {
        tenantId: tenant.id,
        parentProductId: laptopPro.id,
        name: 'Laptop Pro 15" Assembly',
        version: '1.0',
        type: BOMType.MANUFACTURING,
        status: BOMStatus.ACTIVE,
        effectiveFrom: new Date('2024-01-01'),
        baseQuantity: 1,
        baseUOM: 'EA',
        notes: 'Standard manufacturing BOM for high-end laptop',
      },
    });
    boms.push(bomLaptopPro);

    // Add components for Laptop Pro
    const laptopProComponents = [
      { productCode: 'COMP-CPU-I7', qty: 1, sequence: 10 },
      { productCode: 'COMP-RAM-16', qty: 2, sequence: 20 },
      { productCode: 'COMP-SSD-512', qty: 1, sequence: 30 },
      { productCode: 'COMP-MB-PRO', qty: 1, sequence: 40 },
      { productCode: 'COMP-LCD-15', qty: 1, sequence: 50 },
      { productCode: 'COMP-BATT', qty: 1, sequence: 60 },
      { productCode: 'COMP-CASE-L', qty: 1, sequence: 70 },
      { productCode: 'COMP-KB', qty: 1, sequence: 80 },
      { productCode: 'COMP-GPU', qty: 1, sequence: 90 },
      { productCode: 'PKG-BOX-L', qty: 1, sequence: 100 },
      { productCode: 'PKG-FOAM', qty: 2, sequence: 110 },
      { productCode: 'PKG-MANUAL', qty: 1, sequence: 120 },
      { productCode: 'PKG-CABLE', qty: 1, sequence: 130 },
    ];

    for (const comp of laptopProComponents) {
      const compProduct = getProduct(comp.productCode);
      if (compProduct) {
        await prisma.bOMComponent.create({
          data: {
            bomId: bomLaptopPro.id,
            componentProductId: compProduct.id,
            sequence: comp.sequence,
            quantity: comp.qty,
            uom: 'EA',
            scrapPercent: comp.productCode.startsWith('COMP-') ? 2 : 0,
            supplyType: SupplyType.STOCK,
            isCritical: ['COMP-CPU-I7', 'COMP-LCD-15'].includes(comp.productCode),
          },
        });
      }
    }
  }

  // BOM for Laptop Air 13"
  if (laptopAir) {
    const bomLaptopAir = await prisma.billOfMaterial.create({
      data: {
        tenantId: tenant.id,
        parentProductId: laptopAir.id,
        name: 'Laptop Air 13" Assembly',
        version: '1.0',
        type: BOMType.MANUFACTURING,
        status: BOMStatus.ACTIVE,
        effectiveFrom: new Date('2024-01-01'),
        baseQuantity: 1,
        baseUOM: 'EA',
        notes: 'Standard manufacturing BOM for lightweight laptop',
      },
    });
    boms.push(bomLaptopAir);

    const laptopAirComponents = [
      { productCode: 'COMP-CPU-I5', qty: 1, sequence: 10 },
      { productCode: 'COMP-RAM-8', qty: 1, sequence: 20 },
      { productCode: 'COMP-SSD-256', qty: 1, sequence: 30 },
      { productCode: 'COMP-MB-STD', qty: 1, sequence: 40 },
      { productCode: 'COMP-LCD-13', qty: 1, sequence: 50 },
      { productCode: 'COMP-BATT', qty: 1, sequence: 60 },
      { productCode: 'COMP-CASE-L', qty: 1, sequence: 70 },
      { productCode: 'COMP-KB', qty: 1, sequence: 80 },
      { productCode: 'PKG-BOX-L', qty: 1, sequence: 90 },
      { productCode: 'PKG-FOAM', qty: 2, sequence: 100 },
      { productCode: 'PKG-MANUAL', qty: 1, sequence: 110 },
      { productCode: 'PKG-CABLE', qty: 1, sequence: 120 },
    ];

    for (const comp of laptopAirComponents) {
      const compProduct = getProduct(comp.productCode);
      if (compProduct) {
        await prisma.bOMComponent.create({
          data: {
            bomId: bomLaptopAir.id,
            componentProductId: compProduct.id,
            sequence: comp.sequence,
            quantity: comp.qty,
            uom: 'EA',
            scrapPercent: comp.productCode.startsWith('COMP-') ? 2 : 0,
            supplyType: SupplyType.STOCK,
            isCritical: ['COMP-CPU-I5', 'COMP-LCD-13'].includes(comp.productCode),
          },
        });
      }
    }
  }

  // BOM for Desktop Workstation
  if (desktop) {
    const bomDesktop = await prisma.billOfMaterial.create({
      data: {
        tenantId: tenant.id,
        parentProductId: desktop.id,
        name: 'Desktop Workstation Assembly',
        version: '1.0',
        type: BOMType.MANUFACTURING,
        status: BOMStatus.ACTIVE,
        effectiveFrom: new Date('2024-01-01'),
        baseQuantity: 1,
        baseUOM: 'EA',
        notes: 'High-performance workstation with dedicated GPU',
      },
    });
    boms.push(bomDesktop);

    const desktopComponents = [
      { productCode: 'COMP-CPU-I7', qty: 1, sequence: 10 },
      { productCode: 'COMP-RAM-16', qty: 4, sequence: 20 },
      { productCode: 'COMP-SSD-512', qty: 2, sequence: 30 },
      { productCode: 'COMP-MB-PRO', qty: 1, sequence: 40 },
      { productCode: 'COMP-GPU-PRO', qty: 1, sequence: 50 },
      { productCode: 'COMP-PSU', qty: 1, sequence: 60 },
      { productCode: 'COMP-CASE-D', qty: 1, sequence: 70 },
      { productCode: 'PKG-BOX-D', qty: 1, sequence: 80 },
      { productCode: 'PKG-FOAM', qty: 4, sequence: 90 },
      { productCode: 'PKG-MANUAL', qty: 1, sequence: 100 },
      { productCode: 'PKG-CABLE', qty: 1, sequence: 110 },
    ];

    for (const comp of desktopComponents) {
      const compProduct = getProduct(comp.productCode);
      if (compProduct) {
        await prisma.bOMComponent.create({
          data: {
            bomId: bomDesktop.id,
            componentProductId: compProduct.id,
            sequence: comp.sequence,
            quantity: comp.qty,
            uom: 'EA',
            scrapPercent: comp.productCode.startsWith('COMP-') ? 1.5 : 0,
            supplyType: SupplyType.STOCK,
            isCritical: ['COMP-CPU-I7', 'COMP-GPU-PRO'].includes(comp.productCode),
          },
        });
      }
    }
  }

  // BOM for Monitor 27"
  if (monitor27) {
    const bomMonitor27 = await prisma.billOfMaterial.create({
      data: {
        tenantId: tenant.id,
        parentProductId: monitor27.id,
        name: 'Monitor 27" 4K Assembly',
        version: '1.0',
        type: BOMType.MANUFACTURING,
        status: BOMStatus.ACTIVE,
        effectiveFrom: new Date('2024-01-01'),
        baseQuantity: 1,
        baseUOM: 'EA',
      },
    });
    boms.push(bomMonitor27);

    const monitor27Components = [
      { productCode: 'COMP-LCD-27', qty: 1, sequence: 10 },
      { productCode: 'COMP-CASE-M', qty: 1, sequence: 20 },
      { productCode: 'COMP-PSU', qty: 1, sequence: 30 },
      { productCode: 'PKG-BOX-M', qty: 1, sequence: 40 },
      { productCode: 'PKG-FOAM', qty: 2, sequence: 50 },
      { productCode: 'PKG-MANUAL', qty: 1, sequence: 60 },
      { productCode: 'PKG-CABLE', qty: 2, sequence: 70 },
    ];

    for (const comp of monitor27Components) {
      const compProduct = getProduct(comp.productCode);
      if (compProduct) {
        await prisma.bOMComponent.create({
          data: {
            bomId: bomMonitor27.id,
            componentProductId: compProduct.id,
            sequence: comp.sequence,
            quantity: comp.qty,
            uom: 'EA',
            scrapPercent: 1,
            supplyType: SupplyType.STOCK,
            isCritical: comp.productCode === 'COMP-LCD-27',
          },
        });
      }
    }
  }

  // BOM for Monitor 32"
  if (monitor32) {
    const bomMonitor32 = await prisma.billOfMaterial.create({
      data: {
        tenantId: tenant.id,
        parentProductId: monitor32.id,
        name: 'Monitor 32" Curved Assembly',
        version: '1.0',
        type: BOMType.MANUFACTURING,
        status: BOMStatus.ACTIVE,
        effectiveFrom: new Date('2024-01-01'),
        baseQuantity: 1,
        baseUOM: 'EA',
      },
    });
    boms.push(bomMonitor32);

    const monitor32Components = [
      { productCode: 'COMP-LCD-32', qty: 1, sequence: 10 },
      { productCode: 'COMP-CASE-M', qty: 1, sequence: 20 },
      { productCode: 'COMP-PSU', qty: 1, sequence: 30 },
      { productCode: 'PKG-BOX-M', qty: 1, sequence: 40 },
      { productCode: 'PKG-FOAM', qty: 3, sequence: 50 },
      { productCode: 'PKG-MANUAL', qty: 1, sequence: 60 },
      { productCode: 'PKG-CABLE', qty: 2, sequence: 70 },
    ];

    for (const comp of monitor32Components) {
      const compProduct = getProduct(comp.productCode);
      if (compProduct) {
        await prisma.bOMComponent.create({
          data: {
            bomId: bomMonitor32.id,
            componentProductId: compProduct.id,
            sequence: comp.sequence,
            quantity: comp.qty,
            uom: 'EA',
            scrapPercent: 1,
            supplyType: SupplyType.STOCK,
            isCritical: comp.productCode === 'COMP-LCD-32',
          },
        });
      }
    }
  }

  console.log(`✅ Created ${boms.length} bills of material with components`);

  // ============================================
  // ROUTINGS - Manufacturing process steps
  // ============================================
  const getWorkCenter = (code: string) => workCenters.find(wc => wc.code === code);

  for (const bom of boms) {
    const routing = await prisma.routing.create({
      data: {
        tenantId: tenant.id,
        bomId: bom.id,
        name: `${bom.name} Routing`,
        version: '1.0',
        status: BOMStatus.ACTIVE,
        totalLeadTime: 3,
        totalSetupTime: 45,
        totalRunTime: 120,
      },
    });

    // Determine if this is a laptop/desktop or monitor based on name
    const isMonitor = bom.name.includes('Monitor');
    const isDesktop = bom.name.includes('Desktop');
    const isLaptop = bom.name.includes('Laptop');

    if (isMonitor) {
      // Monitor routing: LCD Assembly -> Testing -> Packaging
      const ops = [
        { wc: 'WC-LCD-01', seq: 10, code: 'LCD-ASSY', name: 'LCD Panel Assembly', setup: 15, run: 20 },
        { wc: 'WC-TEST-01', seq: 20, code: 'TEST', name: 'Quality Testing', setup: 5, run: 10 },
        { wc: 'WC-PACK-01', seq: 30, code: 'PACK', name: 'Packaging', setup: 2, run: 5 },
      ];
      for (const op of ops) {
        const wc = getWorkCenter(op.wc);
        if (wc) {
          await prisma.routingOperation.create({
            data: {
              routingId: routing.id,
              workCenterId: wc.id,
              sequence: op.seq,
              operationCode: op.code,
              operationName: op.name,
              setupTime: op.setup,
              runTimePerUnit: op.run,
              yieldPercent: 99,
            },
          });
        }
      }
    } else {
      // Laptop/Desktop routing: SMT -> Assembly -> Burn-in -> Testing -> Packaging
      const ops = [
        { wc: 'WC-SMT-01', seq: 10, code: 'SMT', name: 'PCB Assembly', setup: 30, run: 15 },
        { wc: 'WC-ASSY-01', seq: 20, code: 'FINAL-ASSY', name: 'Final Assembly', setup: 10, run: isDesktop ? 45 : 35 },
        { wc: 'WC-BURN-01', seq: 30, code: 'BURN-IN', name: 'Burn-in Testing', setup: 5, run: 60 },
        { wc: 'WC-TEST-01', seq: 40, code: 'QA-TEST', name: 'Quality Assurance', setup: 5, run: 15 },
        { wc: 'WC-PACK-01', seq: 50, code: 'PACK', name: 'Packaging', setup: 2, run: 8 },
      ];
      for (const op of ops) {
        const wc = getWorkCenter(op.wc);
        if (wc) {
          await prisma.routingOperation.create({
            data: {
              routingId: routing.id,
              workCenterId: wc.id,
              sequence: op.seq,
              operationCode: op.code,
              operationName: op.name,
              setupTime: op.setup,
              runTimePerUnit: op.run,
              yieldPercent: op.code === 'BURN-IN' ? 98 : 99,
            },
          });
        }
      }
    }
  }
  console.log(`✅ Created ${boms.length} routings with operations`);

  // ============================================
  // INVENTORY POLICIES - Planning parameters
  // ============================================
  let policyCount = 0;
  const warehouseLocations = locations.filter(l => l.type === LocationType.WAREHOUSE);

  // Set policies for finished goods (MRP planning)
  const finishedGoods = products.filter(p => ['ELEC-001', 'ELEC-002', 'ELEC-003', 'ELEC-004', 'ELEC-005'].includes(p.code));
  for (const product of finishedGoods) {
    for (const location of warehouseLocations) {
      await prisma.inventoryPolicy.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          locationId: location.id,
          planningMethod: PlanningMethod.MRP,
          lotSizingRule: LotSizingRule.FOQ,
          safetyStockMethod: SafetyStockMethod.DAYS_OF_SUPPLY,
          safetyStockDays: 7,
          serviceLevel: 95,
          reorderPoint: 50,
          reorderQty: 100,
          minOrderQty: 10,
          maxOrderQty: 500,
          multipleOrderQty: 10,
          leadTimeDays: 5,
          safetyLeadTime: 2,
          abcClass: 'A',
          effectiveFrom: new Date('2024-01-01'),
        },
      });
      policyCount++;
    }
  }

  // Set policies for components (reorder point with longer lead times)
  const components = products.filter(p => p.code.startsWith('COMP-'));
  for (const product of components) {
    for (const location of warehouseLocations.slice(0, 2)) { // Only primary warehouses
      const leadTime = supplierProductMappings.find(sp => sp.productCode === product.code)?.leadTime || 14;
      await prisma.inventoryPolicy.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          locationId: location.id,
          planningMethod: PlanningMethod.REORDER_POINT,
          lotSizingRule: LotSizingRule.EOQ,
          safetyStockMethod: SafetyStockMethod.FIXED,
          safetyStockQty: product.code.includes('CPU') || product.code.includes('LCD') ? 100 : 50,
          serviceLevel: 98,
          reorderPoint: product.code.includes('CPU') || product.code.includes('LCD') ? 200 : 100,
          reorderQty: 500,
          minOrderQty: 50,
          leadTimeDays: leadTime,
          safetyLeadTime: Math.ceil(leadTime * 0.25),
          abcClass: product.code.includes('CPU') || product.code.includes('GPU') ? 'A' : 'B',
          effectiveFrom: new Date('2024-01-01'),
        },
      });
      policyCount++;
    }
  }

  // Set policies for packaging (Min-Max for low value items)
  const packaging = products.filter(p => p.code.startsWith('PKG-'));
  for (const product of packaging) {
    for (const location of warehouseLocations.slice(0, 2)) {
      await prisma.inventoryPolicy.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          locationId: location.id,
          planningMethod: PlanningMethod.MIN_MAX,
          lotSizingRule: LotSizingRule.MIN_MAX,
          safetyStockMethod: SafetyStockMethod.FIXED,
          safetyStockQty: 500,
          minOrderQty: 100,
          maxOrderQty: 5000,
          leadTimeDays: 5,
          abcClass: 'C',
          effectiveFrom: new Date('2024-01-01'),
        },
      });
      policyCount++;
    }
  }
  console.log(`✅ Created ${policyCount} inventory policies`);

  // ============================================
  // INVENTORY LEVELS - Current stock positions
  // ============================================
  let levelCount = 0;

  // Finished goods inventory
  for (const product of finishedGoods) {
    for (const location of warehouseLocations) {
      const baseQty = 50 + Math.floor(seededRandom() * 150);
      await prisma.inventoryLevel.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          locationId: location.id,
          onHandQty: baseQty,
          allocatedQty: Math.floor(baseQty * 0.2),
          availableQty: Math.floor(baseQty * 0.8),
          inTransitQty: Math.floor(seededRandom() * 30),
          onOrderQty: Math.floor(seededRandom() * 100),
          standardCost: product.standardCost,
          averageCost: product.standardCost * (0.95 + seededRandom() * 0.1),
          inventoryValue: baseQty * product.standardCost,
          lastReceiptDate: new Date(Date.now() - Math.floor(seededRandom() * 7 * 24 * 60 * 60 * 1000)),
          lastIssueDate: new Date(Date.now() - Math.floor(seededRandom() * 3 * 24 * 60 * 60 * 1000)),
        },
      });
      levelCount++;
    }
  }

  // Component inventory (higher quantities)
  for (const product of components) {
    for (const location of warehouseLocations.slice(0, 2)) {
      const baseQty = 200 + Math.floor(seededRandom() * 800);
      await prisma.inventoryLevel.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          locationId: location.id,
          onHandQty: baseQty,
          allocatedQty: Math.floor(baseQty * 0.15),
          availableQty: Math.floor(baseQty * 0.85),
          inTransitQty: Math.floor(seededRandom() * 100),
          onOrderQty: Math.floor(seededRandom() * 500),
          standardCost: product.standardCost,
          inventoryValue: baseQty * product.standardCost,
          lastReceiptDate: new Date(Date.now() - Math.floor(seededRandom() * 14 * 24 * 60 * 60 * 1000)),
        },
      });
      levelCount++;
    }
  }

  // Packaging inventory (high quantities)
  for (const product of packaging) {
    for (const location of warehouseLocations.slice(0, 2)) {
      const baseQty = 1000 + Math.floor(seededRandom() * 3000);
      await prisma.inventoryLevel.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          locationId: location.id,
          onHandQty: baseQty,
          availableQty: baseQty,
          standardCost: product.standardCost,
          inventoryValue: baseQty * product.standardCost,
          lastReceiptDate: new Date(Date.now() - Math.floor(seededRandom() * 30 * 24 * 60 * 60 * 1000)),
        },
      });
      levelCount++;
    }
  }
  console.log(`✅ Created ${levelCount} inventory level records`);

  console.log('\n🏭 Manufacturing data seeding complete!\n');

  // ============================================
  // WORKFLOW TEMPLATES
  // ============================================
  console.log('\n📋 Seeding workflow templates...');

  const workflowTemplates = [
    {
      name: 'Plan Approval Workflow',
      description: 'Standard approval workflow for plan versions requiring manager sign-off',
      entityType: WorkflowEntityType.PLAN_VERSION,
      steps: [
        { sequence: 1, name: 'Manager Review', approverType: ApproverType.ROLE, approverRole: UserRole.ADMIN, requiredApprovals: 1, canReject: true, canDelegate: true },
      ],
    },
    {
      name: 'Forecast Override Approval',
      description: 'Approval workflow for manual forecast overrides',
      entityType: WorkflowEntityType.FORECAST_OVERRIDE,
      steps: [
        { sequence: 1, name: 'Planner Review', approverType: ApproverType.ROLE, approverRole: UserRole.PLANNER, requiredApprovals: 1, canReject: true, canDelegate: false },
        { sequence: 2, name: 'Finance Approval', approverType: ApproverType.ROLE, approverRole: UserRole.FINANCE, requiredApprovals: 1, canReject: true, canDelegate: true },
      ],
    },
    {
      name: 'BOM Change Approval',
      description: 'Quality gate for bill of material changes',
      entityType: WorkflowEntityType.BOM,
      steps: [
        { sequence: 1, name: 'Engineering Review', approverType: ApproverType.ROLE, approverRole: UserRole.PLANNER, requiredApprovals: 1, canReject: true, canDelegate: false },
        { sequence: 2, name: 'Production Head Approval', approverType: ApproverType.ROLE, approverRole: UserRole.ADMIN, requiredApprovals: 1, canReject: true, canDelegate: true },
      ],
    },
    {
      name: 'Promotion Approval',
      description: 'Multi-step approval for promotional plans',
      entityType: WorkflowEntityType.PROMOTION,
      steps: [
        { sequence: 1, name: 'Brand Manager Review', approverType: ApproverType.ROLE, approverRole: UserRole.PLANNER, requiredApprovals: 1, canReject: true, canDelegate: false },
        { sequence: 2, name: 'Finance Sign-off', approverType: ApproverType.ROLE, approverRole: UserRole.FINANCE, requiredApprovals: 1, canReject: true, canDelegate: true },
      ],
    },
    {
      name: 'Scenario Approval',
      description: 'Approval for scenarios before publishing',
      entityType: WorkflowEntityType.SCENARIO,
      steps: [
        { sequence: 1, name: 'Lead Planner Approval', approverType: ApproverType.ROLE, approverRole: UserRole.ADMIN, requiredApprovals: 1, canReject: true, canDelegate: true },
      ],
    },
    {
      name: 'Planned Order Release',
      description: 'Approval workflow for MRP planned order release',
      entityType: WorkflowEntityType.PLANNED_ORDER,
      steps: [
        { sequence: 1, name: 'Production Planner Approval', approverType: ApproverType.ROLE, approverRole: UserRole.PLANNER, requiredApprovals: 1, canReject: true, canDelegate: false },
      ],
    },
  ];

  for (const tpl of workflowTemplates) {
    await prisma.workflowTemplate.create({
      data: {
        tenantId: tenant.id,
        name: tpl.name,
        description: tpl.description,
        entityType: tpl.entityType,
        isActive: true,
        steps: {
          create: tpl.steps,
        },
      },
    });
  }
  console.log(`✅ Created ${workflowTemplates.length} workflow templates`);

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '═'.repeat(50));
  console.log('🎉 DATABASE SEEDING COMPLETED SUCCESSFULLY!');
  console.log('═'.repeat(50));
  console.log('\n📊 Data Summary:');
  console.log(`   • Products:          ${products.length} (incl. ${components.length} components, ${packaging.length} packaging)`);
  console.log(`   • Locations:         ${locations.length}`);
  console.log(`   • Customers:         ${customers.length}`);
  console.log(`   • Accounts:          ${accounts.length}`);
  console.log(`   • Actuals:           ${actualsCount.toLocaleString()}`);
  console.log(`   • Plans:             3`);
  console.log(`   • Scenarios:         6`);
  console.log(`   • Forecasts:         ${forecastCount.toLocaleString()}`);
  console.log(`   • Time Buckets:      ${timeBucketCount}`);
  console.log(`   • Forecast Runs:     ${runCount}`);
  console.log(`   • Forecast Results:  ${resultCount.toLocaleString()}`);
  console.log('\n🏭 Manufacturing Data:');
  console.log(`   • Work Centers:      ${workCenters.length}`);
  console.log(`   • Suppliers:         ${suppliers.length}`);
  console.log(`   • Supplier Products: ${supplierProductCount}`);
  console.log(`   • Bills of Material: ${boms.length}`);
  console.log(`   • Inventory Policies: ${policyCount}`);
  console.log(`   • Inventory Levels:  ${levelCount}`);
  console.log('\n📋 Login Credentials:');
  console.log('━'.repeat(50));
  console.log(`   Email:     ${seedTenant.adminEmail}`);
  console.log(`   Password:  ${seedTenant.adminPassword}`);
  console.log('━'.repeat(50));
  console.log('\n✨ You can now explore the full application with realistic data!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
