const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { role: { in: ['CAPTAIN', 'DRIVER'] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phoneNumber: true,
      role: true,
      driverProfile: {
        select: {
          id: true,
          currentLat: true,
          currentLng: true,
          isAvailable: true,
          verificationStatus: true,
        },
      },
    },
  });

  console.log('Captains found:', users.length);
  console.log(JSON.stringify(users, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
