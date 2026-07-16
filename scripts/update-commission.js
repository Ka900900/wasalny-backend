require('dotenv').config();
const prisma = require('../src/config/prisma');
(async () => {
  const before = await prisma.config.findUnique({ where: { key: 'COMMISSION_RATE' } });
  console.log('BEFORE:', JSON.stringify(before));
  const updated = await prisma.config.update({
    where: { key: 'COMMISSION_RATE' },
    data: { value: '0.12', description: 'نسبة عمولة التطبيق (0.12 = 12%) — قابلة للتعديل من غير كود' },
  });
  console.log('AFTER :', JSON.stringify(updated));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
