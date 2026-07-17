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
 * Create a Kashier payment session.
 * تعيد بيانات عامة فقط (بدون أي سر) لإتمام الدفع في تطبيق Flutter.
 */
async function createKashierSession(orderId, amount, customerName, customerPhone, description) {
  const mid = process.env.KASHIER_MID;
  const mode = process.env.KASHIER_MODE || 'live';
  const currency = 'EGP';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  const formattedAmount = Number(amount).toFixed(2);
  const signature = generateKashierSignature(orderId, amount, currency);
  const merchantRedirect = `${appUrl}/payment/callback`;
  const webhookUrl = `${appUrl}/api/webhooks/kashier`;

  const requestBody = {
    orderId,
    amount: formattedAmount,
    currency,
    customer: { name: customerName, phone: customerPhone },
    description,
    redirectUrl: merchantRedirect,
    webhookUrl,
    signature,
    mode,
    mid,
  };

  const endpoint = 'https://checkout.kashier.io/v1/payments'; // بيئة الإنتاج (Live) فقط — لا روابط اختبار

  const response = await axios.post(endpoint, requestBody, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.KASHIER_API_KEY}`,
    },
    timeout: 10000,
  });

  // بيانات عامة فقط — لا يحتوي الرد على KASHIER_SECRET_KEY ولا KASHIER_API_KEY
  return {
    orderId,
    sessionId: orderId,
    amount: formattedAmount,
    currency,
    mid,
    mode,
    signature,
    merchantRedirect,
    webhookUrl,
    paymentUrl: response.data?.paymentUrl || response.data?.url || null,
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
