/**
 * Seed script — populates FAQs table with standard Arabic questions
 * for both Riders and Drivers.
 *
 * Usage: node prisma/seed-faqs.js
 */
const prisma = require('../src/config/prisma');

const faqs = [
  // ── Rider FAQs ──────────────────────────────────────
  {
    question: 'ماذا أفعل إذا نسيت متعلقاتي داخل السيارة؟',
    answer:
      'يمكنك التواصل مع الكابتن مباشرة عبر سجل الرحلات خلال ساعتين من انتهاء الرحلة، أو فتح تذكرة دعم فني وسيساعدك فريقنا فوراً.',
    category: 'TRIP',
    order: 1,
  },
  {
    question: 'هل يتم فرض رسوم عند إلغاء الرحلة؟',
    answer:
      'يكون الإلغاء مجانياً خلال أول 3 دقائق من قبول الكابتن للطلب. بعد ذلك قد تُطبق رسوم إلغاء بسيطة تعويضاً لوقت الكابتن.',
    category: 'TRIP',
    order: 2,
  },
  {
    question: 'هل يمكنني تغيير وجهة الوصول أثناء الرحلة؟',
    answer:
      'نعم، يمكنك تعديل الوجهة مباشرة من داخل التطبيق أثناء الرحلة، وستتم إعادة احتساب التكلفة تلقائياً بناءً على المسار الجديد.',
    category: 'TRIP',
    order: 3,
  },
  {
    question: 'كيف يتم احتساب تكلفة الرحلة؟',
    answer:
      'تُحسب التكلفة بناءً على فتح البنديرة + الأجرة لكل كيلومتر + الوقت المستغرق، وتظهر التكلفة التقديرية قبل تأكيد الطلب.',
    category: 'PAYMENT',
    order: 4,
  },
  {
    question: 'ما هي طرق الدفع المتاحة في وصلني؟',
    answer:
      'نوفر الدفع نقداً (Cash)، أو عبر المحفظة الإلكترونية داخل التطبيق، أو بواسطة البطاقات البنكية.',
    category: 'PAYMENT',
    order: 5,
  },
  {
    question: 'كيف أستخدم رصيد المحفظة في دفع الرحلات؟',
    answer:
      'يتم خصم قيمة الرحلة تلقائياً من رصيد محفظتك إذا كان يغطي التكلفة، أو يمكنك اختيار دفع الفارق نقداً.',
    category: 'PAYMENT',
    order: 6,
  },
  {
    question: 'كيف يمكنني تعديل بيانات حسابي أو رقم الهاتف؟',
    answer:
      'من قائمة "حسابي" في التطبيق، اضغط على تعديل الملف الشخصي لتغيير الاسم أو رقم الهاتف أو البريد الإلكتروني.',
    category: 'ACCOUNT',
    order: 7,
  },
  {
    question: 'هل الرحلات مؤمنة ومراقبة؟',
    answer:
      'نعم، جميع الرحلات يتم تتبعها عبر GPS مباشرة، وتتوفر خاصية مشاركة تفاصيل الرحلة وزر الطوارئ داخل التطبيق.',
    category: 'SAFETY',
    order: 8,
  },
  // ── Driver FAQs ─────────────────────────────────────
  {
    question: 'كيف يتم احتساب نسبة التطبيق من الرحلة؟',
    answer:
      'تتحدد نسبة التطبيق بناءً على نوع الرحلة والمنطقة، وتظهر لك صافي أرباحك بوضوح قبل وبعد قبول كل رحلة.',
    category: 'DRIVER',
    order: 9,
  },
  {
    question: 'متى وكيف يمكنني سحب أرباحي من المحفظة؟',
    answer:
      'يمكنك تقديم طلب سحب أرباح عبر المحفظة الإلكترونية أو الحساب البنكي عند الوصول للحد الأدنى للسحب، ويتم معالجة الطلب خلال 24 ساعة.',
    category: 'DRIVER',
    order: 10,
  },
  {
    question: 'ماذا أفعل إذا تعرضت لتقييم غير عادل من راكب؟',
    answer:
      'يمكنك فتح تذكرة دعم فني واختيار الرحلة المعنية، وسيراجع فريق الدعم تفاصيل الرحلة وتعديل التقييم إذا ثبت وجود إجحاف.',
    category: 'DRIVER',
    order: 11,
  },
];

async function main() {
  console.log('🌱 Seeding FAQs...');

  // مسح الـ FAQs القديمة لتجنب التكرار
  const deleted = await prisma.fAQ.deleteMany();
  console.log(`🗑️  Cleared ${deleted.count} existing FAQ(s).`);

  for (const faq of faqs) {
    await prisma.fAQ.create({ data: faq });
    console.log(`  ✅ [${faq.category}] ${faq.question}`);
  }

  console.log(`\n🎉 Successfully seeded ${faqs.length} FAQs.`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
