require('dotenv').config();
const prisma = require('../src/config/prisma');
(async () => {
  const rows = await prisma.config.findMany({ where: { key: 'COMMISSION_RATE' } });
  console.log('COMMISSION_RATE rows:', JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
