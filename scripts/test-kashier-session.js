/**
 * سكريبت اختبار: ينشئ جلسة دفع حقيقية مع كاشير (live) للتأكد من صحة التكامل.
 * يشغّل: node scripts/test-kashier-session.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createKashierSession } = require('../src/services/kashier');

// مستخدم تجريبي يمثّل بيانات حقيقية (مش من DB عشان نتجنب ربط DB)
const testCustomer = {
  id: 'test_user_123',
  firstName: 'Test',
  lastName: 'User',
  email: 'test@wasalny.app',
  phoneNumber: '+201000000000',
};

(async () => {
  try {
    console.log('=== بدء اختبار إنشاء جلسة كاشير ===');
    const session = await createKashierSession(
      `test_${Date.now()}`,
      10.0,
      'اختبار تكامل كاشير',
      'card',
      testCustomer
    );
    console.log('=== نجح إنشاء الجلسة ===');
    console.log(JSON.stringify({
      sessionId: session.sessionId,
      sessionUrl: session.sessionUrl,
      paymentUrl: session.paymentUrl,
      orderId: session.orderId,
      amount: session.amount,
      currency: session.currency,
      status: session.status,
    }, null, 2));
    console.log('\n✅ يمكنك فتح sessionUrl في المتصفح لإجراء دفعة تجريبية.');
    process.exit(0);
  } catch (err) {
    console.error('=== فشل الاختبار ===');
    console.error(err.message);
    process.exit(1);
  }
})();
