/**
 * ضبط المنطقة السكنية (المحافظة) للكابتن على خريطة لوحة التحكم:
 *   residenceGovernorate = "الجيزة"
 * يعثر على المستخدم برقم الهاتف ثم يحدّث DriverProfile المرتبط به فقط
 * (لا يغيّر الاسم / الهاتف / الحالة / المحفظة / الموقع ... إلخ).
 *
 * الاستخدام:
 *   node --env-file="G:\waslny_backend\.env" "G:\waslny_backend\scripts\set-captain-governorate.js" "+201066702477" "الجيزة"
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_GOVERNORATE = 'الجيزة';

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
  const gov = (process.argv[3] || '').trim() || DEFAULT_GOVERNORATE;
  const phones = candidatePhones(phoneArg);

  console.log('🔎 Searching by phone:', phones.join(', '));
  console.log('🏷️ Governorate:', gov);

  let users = await prisma.user.findMany({
    where: { phoneNumber: { in: phones } },
    select: {
      id: true, firstName: true, lastName: true, phoneNumber: true, role: true,
      driverProfile: { select: { id: true } },
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
        driverProfile: { select: { id: true } },
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

  // تأكّد أن العمود موجود (idempotent) — يعمل حتى لو الـ client قديم
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "residenceGovernorate" TEXT'
  );

  console.log('\n📄 Before (governorate only):');
  const before = await prisma.$queryRawUnsafe(
    'SELECT "id", "residenceGovernorate", "currentLat", "currentLng", "isAvailable", "verificationStatus" FROM "DriverProfile" WHERE "userId" = $1',
    target.id
  );
  console.log(JSON.stringify(before[0], null, 2));

  await prisma.$executeRawUnsafe(
    'UPDATE "DriverProfile" SET "residenceGovernorate" = $1 WHERE "userId" = $2',
    gov,
    target.id
  );

  console.log('\n✅ After (only residenceGovernorate changed):');
  const after = await prisma.$queryRawUnsafe(
    'SELECT "id", "residenceGovernorate", "currentLat", "currentLng", "isAvailable", "verificationStatus" FROM "DriverProfile" WHERE "userId" = $1',
    target.id
  );
  console.log(JSON.stringify(after[0], null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
