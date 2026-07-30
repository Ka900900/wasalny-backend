const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find captains with driver profile
  const captains = await prisma.user.findMany({
    where: { role: { in: ['CAPTAIN', 'DRIVER'] } },
    select: {
      id: true, firstName: true, lastName: true, phoneNumber: true, role: true,
      driverProfile: true,
    },
    take: 10
  });

  console.log('=== Captains found:', captains.length, '===');
  console.log(JSON.stringify(captains, (key, val) => {
    if (typeof val === 'bigint') return val.toString();
    return val;
  }, 2));

  // Find vehicles
  const vehicles = await prisma.vehicle.findMany({
    take: 10
  });
  console.log('\n=== Vehicles found:', vehicles.length, '===');
  console.log(JSON.stringify(vehicles, (key, val) => {
    if (typeof val === 'bigint') return val.toString();
    return val;
  }, 2));

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
