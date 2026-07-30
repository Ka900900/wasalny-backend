const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const u = await prisma.user.findUnique({
    where: { id: 'cms54nicr0001o20pcr1ymnjg' },
    select: { id: true, fcmToken: true, firstName: true, lastName: true },
  });
  console.log('=== Captain FCM Token ===');
  console.log(JSON.stringify(u, null, 2));
  if (u?.fcmToken) {
    console.log('✅ FCM token موجود — إذن إشعارات Firebase هتوصل للكابتن');
  } else {
    console.log('ℹ️ FCM token غير موجود — الإشعارات مش هتشتغل إلا لما الكابتن يسجل توكن');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  prisma.$disconnect();
});
