const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find RIDER users
  const riders = await prisma.user.findMany({
    where: { role: 'RIDER' },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    take: 10,
  });
  console.log('=== RIDERS ===');
  console.log(JSON.stringify(riders, null, 2));

  // Find all CAPTAIN users with their profiles
  const captains = await prisma.user.findMany({
    where: { role: 'CAPTAIN' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      driverProfile: {
        select: { currentLat: true, currentLng: true, isAvailable: true, carModel: true, carColor: true, vehicleType: true },
      },
    },
    take: 10,
  });
  console.log('=== ALL CAPTAINS ===');
  console.log(JSON.stringify(captains, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  prisma.$disconnect();
});
