/**
 * Database seed script — populates initial data.
 */
const prisma = require('../src/config/prisma');

async function main() {
  console.log('🌱 Seeding database...');

  // Ride options
  const existingOptions = await prisma.rideOption.count();
  if (existingOptions === 0) {
    const options = [
      {
        name: 'economy',
        nameAr: 'اقتصادي',
        description: 'Cheapest option',
        descriptionAr: 'الخيار الأرخص',
        icon: 'economy',
        capacity: 4,
        serviceTier: 'ECO',
        baseFare: 10,
        pricePerKm: 6,
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
        pricePerKm: 9,
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
        pricePerKm: 12,
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
    ];

    for (const opt of options) {
      await prisma.rideOption.create({ data: opt });
      console.log(`  ✅ Created ride option: ${opt.name}`);
    }
  } else {
    console.log(`  ⏭️  Ride options already exist (${existingOptions})`);
  }

  // Global Config (pricing / wallet parameters)
  const configs = [
    { key: 'COMMISSION_RATE', value: '0.12', valueType: 'NUMBER', description: 'نسبة عمولة التطبيق من نصيب الكابتن (مثال 0.12 = 12%) — قابلة للتعديل من غير كود' },
    { key: 'SURGE_MULTIPLIER',     value: '1.3', valueType: 'NUMBER', description: 'مضاعف وقت الذروة' },
    { key: 'SURGE_START_HOUR',     value: '17',  valueType: 'NUMBER', description: 'بداية فترة الذروة (ساعة بنظام 24)' },
    { key: 'SURGE_END_HOUR',       value: '20',  valueType: 'NUMBER', description: 'نهاية فترة الذروة (ساعة بنظام 24)' },
    { key: 'MIN_PRICE_PER_KM',     value: '6',   valueType: 'NUMBER', description: 'أدنى سعر للكيلو (ج.م)' },
    { key: 'MAX_PRICE_PER_KM',     value: '15',  valueType: 'NUMBER', description: 'أقصى سعر للكيلو (ج.م)' },
  ];
  for (const c of configs) {
    await prisma.config.upsert({
      where: { key: c.key },
      update: { value: c.value, valueType: c.valueType, description: c.description },
      create: c,
    });
    console.log(`  ✅ Upserted config: ${c.key}`);
  }
  // تنظيف المفتاح القديم إن وُجد (COMMISSION_PERCENTAGE)
  const removed = await prisma.config.deleteMany({ where: { key: 'COMMISSION_PERCENTAGE' } });
  if (removed.count > 0) console.log(`  🧹 Removed legacy config: COMMISSION_PERCENTAGE`);

  console.log('✅ Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
