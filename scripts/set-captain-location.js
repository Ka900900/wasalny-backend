/**
 * تحديث موقع الكابتن على الخريطة:
 *   currentLat, currentLng, isAvailable = true
 * يعثر على المستخدم برقم الهاتف ثم يحدّث DriverProfile المرتبط به فقط
 * (لا يغيّر الاسم / الهاتف / الحالة / المحفظة ... إلخ).
 *
 * الاستخدام:
 *   node --env-file="G:\waslny_backend\.env" "G:\waslny_backend\scripts\set-captain-location.js" "+201066702477"
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGET_LAT = 30.0444; // وسط القاهرة
const TARGET_LNG = 31.2357;

async function main() {
  const phoneArg = (process.argv[2] || '').trim();
  // نحاول أكثر من صيغة لتغطية طريقة تخزين الرقم في قاعدة البيانات
  const phones = phoneArg
    ? [phoneArg, phoneArg.replace(/^\+/, ''), phoneArg.replace(/^\+?2?0/, '')]
    : ['+201066702477', '201066702477', '01066702477'];

  console.log('🔎 Searching users by phone:', [...new Set(phones)].join(', '));

  const users = await prisma.user.findMany({
    where: { phoneNumber: { in: [...new Set(phones)] } },
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

  if (!users.length) {
    console.log('❌ No user found with those phone numbers.');
    return;
  }

  console.log(`✅ Users found (${users.length}):`);
  for (const u of users) {
    console.log(
      `   - ${u.firstName || ''} ${u.lastName || ''} | phone=${u.phoneNumber} | role=${u.role} | profile=${u.driverProfile ? u.driverProfile.id : 'NONE'}`
    );
  }

  const target = users.find((u) => u.driverProfile);
  if (!target) {
    console.log('❌ No user with a driverProfile found — nothing to update.');
    return;
  }

  console.log('\n📄 Before update:');
  console.log(JSON.stringify(target.driverProfile, null, 2));

  const updated = await prisma.driverProfile.update({
    where: { userId: target.id },
    data: {
      currentLat: TARGET_LAT,
      currentLng: TARGET_LNG,
      isAvailable: true,
    },
  });

  console.log('\n✅ Updated driverProfile (only lat/lng + isAvailable):');
  console.log(
    JSON.stringify(
      {
        id: updated.id,
        userId: updated.userId,
        currentLat: updated.currentLat,
        currentLng: updated.currentLng,
        isAvailable: updated.isAvailable,
        verificationStatus: updated.verificationStatus,
        // للتأكد أننا لم نمسّ بيانات أخرى:
        carModel: updated.carModel,
        carPlateNumber: updated.carPlateNumber,
        totalTrips: updated.totalTrips,
        ratingAvg: updated.ratingAvg,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
