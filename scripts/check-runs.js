const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const runs = await p.forecastRun.findMany({
    where: { status: 'FAILED' },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      id: true,
      forecastModel: true,
      status: true,
      errorMessage: true,
      parameters: true,
      startPeriod: true,
      endPeriod: true,
      inputSnapshot: true,
    },
  });
  for (const r of runs) {
    console.log(`\n--- ${r.forecastModel} (${r.id}) ---`);
    console.log(`  Status: ${r.status}`);
    console.log(`  Period: ${r.startPeriod?.toISOString?.()?.slice(0,10)} → ${r.endPeriod?.toISOString?.()?.slice(0,10)}`);
    console.log(`  Error: ${r.errorMessage}`);
    const snap = typeof r.inputSnapshot === 'string' ? JSON.parse(r.inputSnapshot) : r.inputSnapshot;
    if (snap) {
      console.log(`  historyMonths: ${snap.historyMonths}`);
      console.log(`  dimensions: ${JSON.stringify(snap.dimensions)}`);
      console.log(`  periodType: ${snap.periodType}`);
    }
  }
  await p.$disconnect();
})();
