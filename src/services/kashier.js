/**
 * Kashier payment gateway service.
 */
const axios = require('axios');
const crypto = require('crypto');

/**
 * يولّد توقيع كاشير (HMAC-SHA256) من بيانات الطلب فقط.
 * التوقيع آمن للإرسال إلى التطبيق لأنه خاص بهذه العملية ولا يكشف السر نهائياً.
 */
function generateKashierSignature(orderId, amount, currency = 'EGP') {
  const mid = process.env.KASHIER_MID;
  const secret = process.env.KASHIER_SECRET_KEY;
  const formattedAmount = Number(amount).toFixed(2);
  const data = `/?payment=${mid}.${orderId}.${formattedAmount}.${currency}`;
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Create a Kashier payment session (Payment Sessions API v1).
 * يُنشئ جلسة دفع آمنة عبر Kashier ويرجع Session ID من الـ API.
 * لا يُفصح عن المفاتيح السرية نهائياً.
 */
async function createKashierSession(orderId, amount, customerName, customerPhone, description) {
  const mid = process.env.KASHIER_MID;
  const currency = 'EGP';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const formattedAmount = Number(amount).toFixed(2);
  const webhookUrl = `${appUrl}/api/webhooks/kashier`;
  const callbackUrl = `${appUrl}/api/v1/wallet/kashier-callback`;

  // بيانات الجلسة الآمنة (Payment Sessions بدون توقيع مباشر)
  const requestBody = {
    orderId,
    amount: formattedAmount,
    currency,
    merchant: {
      id: mid,
    },
    customer: {
      name: customerName,
      phone: customerPhone,
    },
    description,
    settings: {
      webhookUrl,
      callbackUrl,
    },
  };

  const endpoint = 'https://api.kashier.io/v1/payment-sessions';
  const response = await axios.post(endpoint, requestBody, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.KASHIER_API_KEY}`,
    },
    timeout: 10000,
  });

  if (!response.data || !response.data.id) {
    throw new Error('فشل في إنشاء جلسة الدفع مع Kashier');
  }

  // رجع Session ID + معلومات آمنة فقط
  return {
    sessionId: response.data.id,
    orderId,
    amount: formattedAmount,
    currency,
    paymentUrl: response.data.paymentUrl || null,
    status: response.data.status || 'PENDING',
  };
}

/**
 * يولّد توقيع كاشير (HMAC-SHA256) بصيغة Checkout JS/Form الرسمية:
 * "mid=" + merchantId + "&orderId=" + orderId + "&amount=" + amount + "&currency=" + currency
 * يُستخدم لزرّ الدفع المدمج (kashier-payment-btn) في صفحة الـ WebView.
 */
function generateKashierCheckoutHash(orderId, amount, currency = 'EGP') {
  const mid = process.env.KASHIER_MID;
  const secret = process.env.KASHIER_SECRET_KEY;
  const formattedAmount = Number(amount).toFixed(2);
  const payload = `mid=${mid}&orderId=${orderId}&amount=${formattedAmount}&currency=${currency}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify a Kashier webhook signature (البيانات الخام + التوقيع من الترويسة).
 */
function verifyWebhookSignature(payload, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.KASHIER_SECRET_KEY)
    .update(payload)
    .digest('hex');
  return signature === expectedSignature;
}

/**
 * استعلام Server-side عن حالة عملية لدى كاشير (للتحقق قبل تحديث قاعدة البيانات).
 * ملاحظة: مسار/توقيع الاستعلام يجب مطابقتُه لتوثيق كاشير الرسمي عند الحاجة.
 */
async function queryKashierTransaction(orderId) {
  const mid = process.env.KASHIER_MID;
  const secret = process.env.KASHIER_SECRET_KEY;
  const mode = process.env.KASHIER_MODE || 'live';
  const sig = crypto.createHmac('sha256', secret).update(`${mid}${orderId}`).digest('hex');
  const base = 'https://api.kashier.io'; // بيئة الإنتاج (Live) فقط — لا روابط اختبار
  const url = `${base}/v2/transactions?merchantId=${mid}&orderId=${orderId}&signature=${sig}`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.KASHIER_API_KEY}` },
      timeout: 10000,
    });
    const t = response.data?.transactions?.[0] || response.data?.data || response.data;
    return { paid: t?.status === 'PAID' || t?.paymentStatus === 'PAID', raw: response.data };
  } catch (err) {
    console.error('Kashier inquiry error:', err.response?.data || err.message);
    return { paid: false, raw: null };
  }
}

module.exports = { generateKashierSignature, generateKashierCheckoutHash, createKashierSession, queryKashierTransaction, verifyWebhookSignature };
