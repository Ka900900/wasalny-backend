// One-off cleanup of orphaned test data from the previous run.
require('dotenv').config();
const prisma = require('../src/config/prisma');

async function main() {
  const users = await prisma.user.findMany({
    where: { OR: [{ firstName: { startsWith: '__TEST_FIRESTORE__' } }, { phoneNumber: { startsWith: '+2010000000' } }, { phoneNumber: { startsWith: '+2011000000' } }] },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  console.log('Found test users:', ids.length);

  // delete wallet transactions for their rides
  const rides = await prisma.rideRequest.findMany({ where: { riderId: { in: ids } }, select: { id: true } });
  const rideIds = rides.map((r) => r.id);
  console.log('Found test rides:', rideIds.length);

  if (rideIds.length) {
    await prisma.walletTransaction.deleteMany({ where: { rideId: { in: rideIds } } });
    await prisma.rideRequest.deleteMany({ where: { id: { in: rideIds } } });
  }
  await prisma.driverProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log('✅ Orphaned test data cleaned.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode || 0); });
