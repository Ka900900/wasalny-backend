/**
 * Quick script to query all RideOption records from the database.
 * Run: node scripts/query-rideoptions.js
 */
const prisma = require('../src/config/prisma');

async function main() {
  const options = await prisma.rideOption.findMany({
    orderBy: { pricePerKm: 'asc' },
  });
  console.log(`\n📋 RideOption records (${options.length} total):\n`);
  console.table(options.map(o => ({
    id: o.id,
    name: o.name,
    nameAr: o.nameAr,
    capacity: o.capacity,
    baseFare: Number(o.baseFare),
    pricePerKm: Number(o.pricePerKm),
    pricePerMinute: Number(o.pricePerMinute),
    multiplier: Number(o.multiplier),
    serviceTier: o.serviceTier ?? '—',
    isActive: o.isActive,
  })));
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
