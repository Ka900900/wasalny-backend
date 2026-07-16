const twilio = require('twilio');

// عميل Twilio يُنشأ مرة واحدة (lazy) ويُعاد استخدامه طوال عمر التطبيق
let twilioClient = null;

function getTwilioClient() {
  if (twilioClient) return twilioClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // لو متغيرات الاعتماد ناقصة نرجّع null عشان نتعامل مع الموقف بأمان
  if (!accountSid || !authToken) {
    return null;
  }

  twilioClient = twilio(accountSid, authToken);
  return twilioClient;
}

/**
 * إرسال تنبيه طوارئ (SOS) عبر SMS لقائمة جهات الاتصال.
 *
 * @param {Array<{name: string, phone: string}>} contacts - أرقام الطوارئ
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} [senderName] - اسم الكابتن/المستخدم (يُستخدم في نص الرسالة)
 * @returns {Promise<Array<{name: string, phone: string, success: boolean, sid?: string, error?: string}>>}
 */
async function sendSOSAlert(contacts, latitude, longitude, senderName) {
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const client = getTwilioClient();

  // بناء رابط الموقع على Google Maps
  const mapLink = `https://maps.google.com/?q=${latitude},${longitude}`;

  // الاسم: إما اسم الكابتن أو fallback لـ "أحد أفراد أسرتك"
  const displayName = senderName && senderName.trim() ? senderName.trim() : 'أحد أفراد أسرتك';

  const body = `🆘 تنبيه طوارئ: ${displayName} في وضع طوارئ. موقعه الحالي: ${mapLink}`;

  // لو إعدادات Twilio ناقصة، نرجع فشل لكل جهة اتصال من غير ما نوقف السيرفر
  if (!client || !fromNumber) {
    const missing = [];
    if (!client) missing.push('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
    if (!fromNumber) missing.push('TWILIO_PHONE_NUMBER');
    return (contacts || []).map((c) => ({
      name: c && c.name,
      phone: c && c.phone,
      success: false,
      error: `إعدادات Twilio ناقصة: ${missing.join('، ')}`,
    }));
  }

  const results = [];

  // ⚠️ مهم: try/catch لكل رقم على حدة.
  // لو رقم فشل (مثلاً مش verified في وضع trial) نسجّل الفشل ونكمل باقي الأرقام من غير ما نوقف.
  for (const contact of contacts || []) {
    try {
      if (!contact || !contact.phone) {
        results.push({
          name: contact && contact.name,
          phone: contact && contact.phone,
          success: false,
          error: 'رقم الهاتف مفقود',
        });
        continue;
      }

      const message = await client.messages.create({
        body,
        from: fromNumber,
        to: contact.phone,
      });

      results.push({
        name: contact.name,
        phone: contact.phone,
        success: true,
        sid: message.sid,
      });
    } catch (err) {
      results.push({
        name: contact.name,
        phone: contact.phone,
        success: false,
        error: err.message || 'فشل إرسال الرسالة',
      });
    }
  }

  return results;
}

module.exports = { sendSOSAlert };
