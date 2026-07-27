/**
 * Seed RideOption table — updates pricing for all 6 types.
 * يستخدم upsert عن طريق name (أول سجل موجود) ليضمن عدم تكرار البيانات
 * ولا يكسر العلاقات الخارجية (foreign keys) مع RideRequest.
 */
const prisma = require('../src/config/prisma');

const OPTIONS = [
  {
    name: 'economy',
    nameAr: 'اقتصادي',
    description: 'Cheapest option',
    descriptionAr: 'الخيار الأرخص',
    icon: 'economy',
    capacity: 4,
    serviceTier: 'ECO',
    baseFare: 10,
    pricePerKm: 4,
    pricePerMinute: 0.75,
    multiplier: 1.0,
    isActive: true,
  },
  {
    name: 'comfort',
    nameAr: 'مريح',
    description: 'Comfortable ride',
    descriptionAr: 'رحلة مريحة',
    icon: 'comfort',
    capacity: 4,
    serviceTier: 'COMFORT',
    baseFare: 15,
    pricePerKm: 6,
    pricePerMinute: 1.0,
    multiplier: 1.0,
    isActive: true,
  },
  {
    name: 'premium',
    nameAr: 'ممتاز',
    description: 'Luxury vehicles',
    descriptionAr: 'سيارات فاخرة',
    icon: 'premium',
    capacity: 4,
    serviceTier: 'PREMIUM',
    baseFare: 25,
    pricePerKm: 10,
    pricePerMinute: 1.5,
    multiplier: 1.5,
    isActive: true,
  },
  {
    name: 'xl',
    nameAr: 'عائلي',
    description: 'Family vehicles',
    descriptionAr: 'سيارات عائلية',
    icon: 'xl',
    capacity: 6,
    serviceTier: null,
    baseFare: 20,
    pricePerKm: 8,
    pricePerMinute: 1.25,
    multiplier: 1.2,
    isActive: true,
  },
  {
    name: 'motorcycle',
    nameAr: 'موتوسيكل',
    description: 'Motorcycle ride',
    descriptionAr: 'رحلة موتوسيكل',
    icon: 'motorcycle',
    capacity: 2,
    serviceTier: null,
    baseFare: 6,
    pricePerKm: 2.5,
    pricePerMinute: 0.375,
    multiplier: 1.0,
    isActive: true,
  },
  {
    name: 'scooter',
    nameAr: 'سكوتر',
    description: 'Scooter ride',
    descriptionAr: 'رحلة سكوتر',
    icon: 'scooter',
    capacity: 1,
    serviceTier: null,
    baseFare: 5,
    pricePerKm: 2,
    pricePerMinute: 0.25,
    multiplier: 1.0,
    isActive: true,
  },
];

async function main() {
  console.log('🏍️  Seeding RideOption table...\n');

  let created = 0;
  let updated = 0;

  for (const opt of OPTIONS) {
    // ابحث عن أول سجل موجود بنفس الاسم
    const existing = await prisma.rideOption.findFirst({
      where: { name: opt.name },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      // حدّث الأسعار والمعلومات
      await prisma.rideOption.update({
        where: { id: existing.id },
        data: opt,
      });
      console.log(`  🔄 Updated: ${opt.name} (id: ${existing.id})`);
      updated++;
    } else {
      // أنشئ سجل جديد
      await prisma.rideOption.create({ data: opt });
      console.log(`  ✅ Created: ${opt.name}`);
      created++;
    }
  }

  // تأكيد نهائي: اجلب كل RideOption
  const all = await prisma.rideOption.findMany({
    where: { isActive: true },
    orderBy: { pricePerKm: 'asc' },
  });

  console.log(`\n📊 Total RideOptions in DB: ${all.length}`);
  console.table(all.map(o => ({
    name: o.name,
    nameAr: o.nameAr,
    baseFare: Number(o.baseFare),
    pricePerKm: Number(o.pricePerKm),
    pricePerMinute: Number(o.pricePerMinute),
    multiplier: Number(o.multiplier),
    capacity: o.capacity,
    isActive: o.isActive,
  })));

  console.log(`\n🏁 Done — ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
