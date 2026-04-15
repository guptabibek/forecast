const { PrismaClient, Prisma } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Truncating all tables...');
  
  const tables = await prisma.$queryRaw(
    Prisma.sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`
  );
  
  const tableNames = tables.map(t => `"${t.tablename}"`).join(', ');
  console.log('Tables:', tableNames);
  
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE`);
  console.log('All tables truncated.');

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Planning Company',
      slug: 'planning',
      domain: 'planning.rabbittech.com.np',
      subdomain: 'planning',
      status: 'ACTIVE',
      tier: 'PROFESSIONAL',
      timezone: 'Asia/Kathmandu',
      fiscalYearStart: 1,
      defaultCurrency: 'NPR',
      settings: {
        dateFormat: 'MM/DD/YYYY',
        defaultForecastModel: 'HOLT_WINTERS',
        features: {
          aiForecasting: true,
          advancedReporting: true,
          scenarioPlanning: true,
        },
        enabledModules: {
          planning: true,
          forecasting: true,
          manufacturing: false,
          reports: true,
          data: true,
        },
      },
    },
  });
  console.log('Created tenant:', tenant.slug);

  // Create domain mapping
  await prisma.domainMapping.create({
    data: {
      tenantId: tenant.id,
      domain: 'planning.rabbittech.com.np',
      isVerified: true,
      verifiedAt: new Date(),
      sslEnabled: true,
    },
  });
  console.log('Created domain mapping');

  // Create admin user
  const passwordHash = await bcrypt.hash('Admin123!', 12);
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@planning.rabbittech.com.np',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log('Created admin user:', user.email);

  // Create essential UOMs
  const uoms = [
    { code: 'EA', name: 'Each', symbol: 'ea', category: 'COUNT', decimals: 0, isBase: true, sortOrder: 1 },
    { code: 'KG', name: 'Kilogram', symbol: 'kg', category: 'WEIGHT', decimals: 3, isBase: true, sortOrder: 2 },
    { code: 'G', name: 'Gram', symbol: 'g', category: 'WEIGHT', decimals: 2, isBase: false, sortOrder: 3 },
    { code: 'L', name: 'Liter', symbol: 'L', category: 'VOLUME', decimals: 3, isBase: true, sortOrder: 4 },
    { code: 'M', name: 'Meter', symbol: 'm', category: 'LENGTH', decimals: 3, isBase: true, sortOrder: 5 },
    { code: 'BOX', name: 'Box', symbol: 'box', category: 'COUNT', decimals: 0, isBase: false, sortOrder: 6 },
    { code: 'PKG', name: 'Package', symbol: 'pkg', category: 'COUNT', decimals: 0, isBase: false, sortOrder: 7 },
    { code: 'DZ', name: 'Dozen', symbol: 'dz', category: 'COUNT', decimals: 0, isBase: false, sortOrder: 8 },
    { code: 'CS', name: 'Case', symbol: 'cs', category: 'COUNT', decimals: 0, isBase: false, sortOrder: 9 },
    { code: 'PLT', name: 'Pallet', symbol: 'plt', category: 'COUNT', decimals: 0, isBase: false, sortOrder: 10 },
  ];

  for (const u of uoms) {
    await prisma.unitOfMeasure.create({
      data: { tenantId: tenant.id, ...u, isActive: true },
    });
  }
  console.log(`Created ${uoms.length} UOMs`);

  // Create essential product categories
  const categories = [
    { code: 'RAW_MATERIAL', name: 'Raw Material', description: 'Raw materials and basic inputs', color: '#6366F1', sortOrder: 1 },
    { code: 'FINISHED_GOOD', name: 'Finished Good', description: 'Completed products ready for sale', color: '#10B981', sortOrder: 2 },
    { code: 'COMPONENT', name: 'Component', description: 'Individual components and parts', color: '#8B5CF6', sortOrder: 3 },
    { code: 'PACKAGING', name: 'Packaging', description: 'Packaging materials', color: '#F59E0B', sortOrder: 4 },
    { code: 'CONSUMABLE', name: 'Consumable', description: 'Consumable supplies', color: '#EF4444', sortOrder: 5 },
  ];

  for (const c of categories) {
    await prisma.productCategory.create({
      data: { tenantId: tenant.id, ...c, isActive: true },
    });
  }
  console.log(`Created ${categories.length} product categories`);

  console.log('\nClean seed complete! DB has only tenant + admin user + essential master data.');
  console.log('Re-sync from Marg EDE to populate products, locations, customers, and actuals.');
  
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
