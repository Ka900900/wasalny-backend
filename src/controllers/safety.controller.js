const prisma = require('../config/prisma');
const { sendSOSAlert } = require('../services/sms.service');

/**
 * POST /api/v1/safety/sos-alert
 * يُرسل تنبيه طوارئ (SMS) لجهات الاتصال اللي اختارها المستخدم.
 * (التحقق من المدخلات يتم عبر Joi validator: sosAlertSchema)
 */
async function sendSOSAlertHandler(req, res) {
  try {
    const { latitude, longitude, contacts } = req.body;

    // ── جلب اسم المستخدم الحالي من الداتابيس ──
    // (الـ JWT فيه userId و role فقط، فبنجلب الاسم من قاعدة البيانات)
    let senderName = '';
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { firstName: true, lastName: true },
      });
      if (user) {
        senderName = `${user.firstName} ${user.lastName}`.trim();
      }
    } catch (dbErr) {
      console.error('⚠️ تعذّر جلب اسم المستخدم لتنبيه الطوارئ:', dbErr.message);
      // نكمل حتى لو فشل جلب الاسم — الرسالة هتستخدم الـ fallback
    }

    // ── إرسال التنبيه لكل جهة اتصال ──
    const results = await sendSOSAlert(contacts, latitude, longitude, senderName);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;

    return res.status(200).json({
      message: 'تمت معالجة تنبيه الطوارئ',
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    console.error('❌ خطأ في معالجة تنبيه SOS:', error);
    return res.status(500).json({ error: 'خطأ أثناء إرسال تنبيه الطوارئ' });
  }
}

module.exports = { sendSOSAlertHandler };
