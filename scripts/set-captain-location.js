/**
 * تحديث موقع الكابتن على الخريطة:
 *   currentLat, currentLng, isAvailable = true
 * يعثر على المستخدم برقم الهاتف ثم يحدّث DriverProfile المرتبط به فقط
 * (لا يغيّر الاسم / الهاتف / الحالة / المحفظة ... إلخ).
 *
 * الاستخدام:
 *   node --env-file="G:\waslny_backend\.env" "G:\waslny_backend\scripts\set-captain-location.js" "+201066702477" [lat] [lng]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// الإحداثيات تُؤخذ من الوسائط إن وُجدت (lat lng)، وإلا تستخدم الافتراضية
const TARGET_LAT = parseFloat(process.argv[3]) || 30.0444;
const TARGET_LNG = parseFloat(process.argv[4]) || 31.2357;

/** يولّد الصيغ الممكنة لرقم هاتف مصري (مع +20 / بدون / بادئ بـ 0 ...) */
function candidatePhones(raw) {
  const out = new Set();
  const add = (p) => { if (p) out.add(p); };
  if (raw) {
    const digits = raw.replace(/\D/g, '');           // 201066702477
    add(raw);                                        // +201066702477
    add(raw.replace(/^\+/, ''));                     // 201066702477
    add(digits.replace(/^20/, '0'));                 // 01066702477
    add(digits.replace(/^20/, ''));                  // 1066702477
    add(digits.replace(/^20/, '+20'));               // +201066702477
  } else {
    ['+201066702477', '201066702477', '01066702477', '1066702477'].forEach(add);
  }
  return [...out];
}

async function main() {
  const phoneArg = (process.argv[2] || '').trim();
  const phones = candidatePhones(phoneArg);

  console.log('🔎 Searching by phone:', phones.join(', '));

  let users = await prisma.user.findMany({
    where: { phoneNumber: { in: phones } },
    select: {
      id: true, firstName: true, lastName: true, phoneNumber: true, role: true,
      driverProfile: {
        select: {
          id: true, currentLat: true, currentLng: true, isAvailable: true,
          verificationStatus: true, carModel: true, carPlateNumber: true,
          totalTrips: true, ratingAvg: true,
        },
      },
    },
  });

  // فشل البحث بالرقم → نبحث بالاسم (Karim / كريم) كخيار مسموح به
  if (!users.length) {
    console.log('   → No phone match; searching by name (Karim/كريم) ...');
    users = await prisma.user.findMany({
      where: {
        role: { in: ['CAPTAIN', 'DRIVER'] },
        OR: [
          { firstName: { contains: 'Karim', mode: 'insensitive' } },
          { lastName: { contains: 'Karim', mode: 'insensitive' } },
          { firstName: { contains: 'كريم' } },
          { lastName: { contains: 'كريم' } },
        ],
      },
      select: {
        id: true, firstName: true, lastName: true, phoneNumber: true, role: true,
        driverProfile: {
          select: {
            id: true, currentLat: true, currentLng: true, isAvailable: true,
            verificationStatus: true, carModel: true, carPlateNumber: true,
            totalTrips: true, ratingAvg: true,
          },
        },
      },
    });
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
