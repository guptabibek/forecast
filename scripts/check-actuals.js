const { PrismaClient, Prisma } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const stats = await p.$queryRaw`
    SELECT period_type AS "periodType",
           COUNT(*)::int AS "count",
           COUNT(DISTINCT product_id)::int AS "products",
           COUNT(DISTINCT location_id)::int AS "locations",
           MIN(period_date) AS "minDate",
           MAX(period_date) AS "maxDate",
           COUNT(DISTINCT period_date)::int AS "distinctDates"
    FROM   actuals
    GROUP  BY period_type
    ORDER  BY count DESC
  `;
  console.log(JSON.stringify(stats, null, 2));
  await p.$disconnect();
})();
