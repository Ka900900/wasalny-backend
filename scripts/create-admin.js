/**
 * إنشاء / تحديث مستخدم أدمن للوحة تحكم وصلني (Admin Panel)
 *
 * الاستخدام:
 *   node scripts/create-admin.js
 *   node scripts/create-admin.js admin@wasalny.app StrongPass123
 *   ADMIN_EMAIL=admin@wasalny.app ADMIN_PASSWORD=StrongPass123 node scripts/create-admin.js
 *
 * ملاحظة: السكربت آمن (Upsert) — إذا وُجد المستخدم بنفس البريد يتم تحديث كلمة المرور والدور فقط
 * ولا يتم حذف أي بيانات موجودة. هذا يتيح تسجيل الدخول عبر POST /api/v1/auth/login
 * بالبريد وكلمة المرور (صلاحية ADMIN).
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || process.argv[2] || 'admin@wasalny.app').trim();
  const password = process.env.ADMIN_PASSWORD || process.argv[3] || 'Admin@123456';

  if (!email || !password || password.length < 6) {
    console.error('❌ يرجى تمرير بريد وكلمة مرور صالحين (كلمة المرور 6 أحرف على الأقل)');
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 10);

  // ملاحظة: email ليس حقلًا فريدًا في الـ schema (الفريد: id / firebaseUid / phoneNumber)
  // لذلك نستخدم findFirst للبحث بالبريد ثم update عبر id.
  let user = await prisma.user.findFirst({ where: { email } });

  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, role: 'ADMIN', isActive: true, isVerified: true },
    });
    console.log(`✅ تم تحديث الأدمن الموجود: ${user.email} (${user.id})`);
  } else {
    // رقم هاتف افتراضي مشتق من البريد (حتمي لتجنب تعارض الـ unique)
    const digest = crypto.createHash('sha256').update(email).digest('hex').slice(0, 9);
    const numeric = parseInt(digest, 16).toString().padStart(10, '0').slice(0, 10);
    const phoneNumber = `+2${numeric}`;

    user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        role: 'ADMIN',
        firstName: 'مدير',
        lastName: 'النظام',
        phoneNumber,
        isActive: true,
        isVerified: true,
      },
    });

    // إنشاء محفظة للأدمن
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) {
      await prisma.wallet.create({
        data: { userId: user.id, balance: 0, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
      });
    }
    console.log(`✅ تم إنشاء الأدمن: ${user.email} (${user.id})`);
  }

  console.log('\n🔑 بيانات الدخول:');
  console.log(`   البريد: ${email}`);
  console.log(`   كلمة المرور: ${password}`);
  console.log('\nيمكنك الآن تسجيل الدخول عبر POST /api/v1/auth/login');
}

main()
  .catch((e) => {
    console.error('❌ خطأ:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
