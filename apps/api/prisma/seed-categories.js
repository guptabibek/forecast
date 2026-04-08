const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function go() {
  const t = await p.tenant.findFirst({ where: { slug: 'demo' } });
  if (!t) { console.log('No demo tenant'); return; }
  
  await p.productCategory.deleteMany({ where: { tenantId: t.id } });
  
  const cats = [
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

  for (const c of cats) {
    await p.productCategory.create({ data: { tenantId: t.id, ...c, isActive: true } });
  }
  
  console.log('Created ' + cats.length + ' product categories');
  await p.$disconnect();
}

go().catch(e => { console.error(e); process.exit(1); });
