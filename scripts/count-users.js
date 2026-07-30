const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.user.count();
  console.log('Total users:', total);
  
  const users = await prisma.user.findMany({
    take: 20,
    select: { id: true, firstName: true, lastName: true, role: true, phoneNumber: true, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log('=== USERS ===');
  console.log(JSON.stringify(users, null, 2));
  
  // Check ride options
  const options = await prisma.rideOption.findMany();
  console.log('=== RIDE OPTIONS ===');
  console.log(JSON.stringify(options, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  prisma.$disconnect();
});
