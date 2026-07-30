const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. All users
  console.log('=== ALL USERS ===');
  const users = await prisma.user.findMany({
    take: 20,
    select: { id: true, firstName: true, lastName: true, role: true, phoneNumber: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(JSON.stringify(users, null, 2));

  // 2. All driver profiles
  console.log('\n=== DRIVER PROFILES ===');
  const profiles = await prisma.driverProfile.findMany({
    take: 10,
    include: {
      user: { select: { id: true, firstName: true, lastName: true, role: true, phoneNumber: true } },
    },
  });
  console.log(JSON.stringify(profiles, null, 2));

  // 3. Check wallets
  console.log('\n=== WALLETS ===');
  const wallets = await prisma.wallet.findMany({ take: 10 });
  console.log(JSON.stringify(wallets, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  prisma.$disconnect();
});
