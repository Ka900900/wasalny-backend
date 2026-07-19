/**
 * Kashier payment gateway service.
 *
 * تم الترقية إلى أحدث إصدار رسمي: Payment Sessions API v3
 * التوثيق: https://developers.kashier.io/payment/payment-sessions
 *
 * أهم التغييرات عن الإصدار القديم (v1/v2):
 *  - إنشاء الجلسة: POST https://api.kashier.io/v3/payment/sessions
 *  - الاستعلام عن الحالة: GET  https://api.kashier.io/v3/payment/sessions/:sessionId/payment
 *  - المصادقة: الترويسة Authorization = المفتاح السري (secret_key)، وترويسة api-key = مفتاح الـ API.
 *  - لم يعد هناك توقيع HMAC مطلوب لإنشاء الجلسة (تمت إزالة generateKashierSignature القديم).
 *  - معرّف الجلسة يُرجَع في الحقل _id، ورابط الدفع (sessionUrl) يُبنى منه.
 */

const axios = require('axios');
const crypto = require('crypto');
const prisma = require('../config/prisma');

/**
 * يختار بيئة كاشير (Live / Test) بناءً على متغيّر KASHIER_MODE.
 * حسب التوثيق الرسمي:
 *   LIVE : https://api.kashier.io
 *   TEST : https://test-api.kashier.io
 * القيمة الافتراضية "live" لأن النظام يعمل على الإنتاج (Railway/Render).
 */
function getKashierBaseUrl() {
  const mode = (process.env.KASHIER_MODE || 'live').toLowerCase();
  return mode === 'test' ? 'https://test-api.kashier.io' : 'https://api.kashier.io';
}

/**
 * يبني ترويسات المصادقة الرسمية لـ v3:
 *   Authorization: <KASHIER_SECRET_KEY>   (السر، وليس Bearer)
 *   api-key: <KASHIER_API_KEY>
 *   Content-Type: application/json
 */
function getKashierHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: process.env.KASHIER_SECRET_KEY, // السر كما يطلبه التوثيق الرسمي
    'api-key': process.env.KASHIER_API_KEY,
  };
}

/**
 * Create a Kashier Payment Session (Payment Sessions API v3).
 *
 * @param {string} orderId      معرّف الطلب الفريد (يُستخدم لاحقاً في الاستعلام)
 * @param {number|string} amount المبلغ (سيُحوّل إلى سلسلة بصيغة 2.00)
 * @param {string} description   وصف الطلب (أقل من 120 حرفاً)
 *
 * @returns {{
 *   sessionId: string,
 *   sessionUrl: string,
 *   paymentUrl: string,   // اسم مستعار متوافق مع الكود القديم (wallet/ride)
 *   orderId: string,
 *   amount: string,
 *   currency: string,
 *   status: string
 * }}
 */
async function createKashierSession(orderId, amount, description, paymentMethod, customer) {
  const mid = process.env.KASHIER_MID;
  const secretKey = process.env.KASHIER_SECRET_KEY;
  const apiKey = process.env.KASHIER_API_KEY;
  const currency = 'EGP';
  const mode = (process.env.KASHIER_MODE || 'live').toLowerCase();
  const appUrl = process.env.APP_URL || 'https://wasalny-backend-production.up.railway.app';
  
  // التحقق من صحة المبلغ قبل التحويل (البند 4)
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('المبلغ غير صالح: يجب أن يكون رقماً موجباً');
  }
  const formattedAmount = numericAmount.toFixed(2);

  const missingConfig = [];
  if (!mid) missingConfig.push('KASHIER_MID');
  if (!secretKey) missingConfig.push('KASHIER_SECRET_KEY');
  if (!apiKey) missingConfig.push('KASHIER_API_KEY');
  if (!appUrl) missingConfig.push('APP_URL');
  if (missingConfig.length) {
    throw new Error(`Kashier configuration missing: ${missingConfig.join(', ')}`);
  }

  const merchantRedirect = `${appUrl}/api/v1/wallet/kashier-callback?orderId=${orderId}`;
  const serverWebhook = `${appUrl}/api/webhooks/kashier`;

  // جسم الطلب الرسمي لـ v3 (انتهاء الصلاحية بعد 30 دقيقة)
  const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const requestBody = {
    expireAt,
    maxFailureAttempts: 3,
    amount: formattedAmount,
    currency,
    order: orderId, // v3 يستخدم order (وليس orderId)
    merchantId: mid,
    merchantRedirect,
    serverWebhook,
    display: 'ar',
    type: 'external',
    description: (description || '').toString().slice(0, 119),
    metaData: { source: 'wasalny', orderId, paymentMethod: paymentMethod || 'card' },
    customer: {
      reference: customer?.id || customer?.firebaseUid || undefined,
      name: `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() || 'Wasalny User',
      email: customer?.email || undefined,
      phone: customer?.phoneNumber || undefined,
    },
  };

  const endpoint = `${getKashierBaseUrl()}/v3/payment/sessions`;

  let response;
  try {
    console.log('[Kashier] POST request', {
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        Authorization: '[REDACTED]',
        'api-key': '[REDACTED]',
      },
      body: requestBody,
    });

    response = await axios.post(endpoint, requestBody, {
      headers: getKashierHeaders(),
      timeout: 30000,
    });

    console.log('[Kashier] POST response', {
      status: response?.status,
      body: response?.data,
    });
  } catch (err) {
    console.error('[Kashier] POST failed', {
      status: err.response?.status,
      headers: err.response?.headers,
      body: err.response?.data,
    });

    // معالجة أخطاء قوية: نرجّع رسالة كاشير إن وُجدت بدل رمي 500 عام
    const kashierMsg =
      err.response?.data?.message ||
      err.response?.data?.error ||
      (typeof err.response?.data === 'string' ? err.response.data : null) ||
      err.message;
    throw new Error(`Kashier create session failed: ${kashierMsg}`);
  }

  const data = response.data;
  if (!data || !data._id) {
    const kashierMsg = data?.message || 'استجابة غير صالحة من Kashier';
    throw new Error(`Kashier create session failed: ${kashierMsg}`);
  }

  // حفظ الربط بين orderId و sessionId في قاعدة البيانات
  await prisma.paymentSession.upsert({
    where: { orderId },
    update: { sessionId: data._id, status: 'CREATED', paymentMethod: paymentMethod || null, amount: formattedAmount, updatedAt: new Date() },
    create: { orderId, sessionId: data._id, paymentMethod: paymentMethod || null, amount: formattedAmount, status: 'CREATED' },
  });
  console.log(`[Kashier] Session saved to DB: orderId=${orderId} → sessionId=${data._id}`);

  // بناء رابط الدفع الرسمي من معرّف الجلسة (حسب التوثيق: payments.kashier.io/session/:id?mode=:mode)
  const sessionUrl = data.sessionUrl ?? `https://payments.kashier.io/session/${data._id}?mode=${mode}`;

  return {
    sessionId: data._id,
    sessionUrl,
    paymentUrl: sessionUrl, // اسم مستعار متوافق مع الكود القديم
    orderId,
    amount: formattedAmount,
    currency,
    status: data.status || 'CREATED',
  };
}

/**
 * يولّد توقيع كاشير (HMAC-SHA256) بصيغة Checkout JS/Form الرسمية:
 * "mid=" + merchantId + "&orderId=" + orderId + "&amount=" + amount + "&currency=" + currency
 * يُستخدم لزرّ الدفع المدمج (kashier-payment-btn) في صفحة الـ WebView الخاصة بالمحفظة.
 * ملاحظة: هذا تدفّق Checkout JS منفصل عن Payment Sessions، لذا يبقى كما هو لعدم كسر wallet.controller.
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
 * يُستخدم في webhook الخاص بـ index.js — لم يتغيّر في v3.
 */
function verifyWebhookSignature(payload, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.KASHIER_SECRET_KEY)
    .update(payload)
    .digest('hex');
  return signature === expectedSignature;
}

/**
 * استعلام Server-side عن حالة جلسة الدفع (Payment Sessions API v3).
 * GET https://api.kashier.io/v3/payment/sessions/:sessionId/payment
 *
 * @param {string} sessionId معرّف الجلسة (_id) أو orderId
 * @returns {{ paid: boolean, status: string|null, amount: string|null, sessionId: string|null }}
 */
async function queryKashierTransaction(id) {
  // إذا كان id هو orderId معروف، نبحث عنه في قاعدة البيانات للحصول على sessionId الحقيقي
  let sessionId = id;
  const stored = await prisma.paymentSession.findUnique({ where: { orderId: id } });
  if (stored?.sessionId) {
    sessionId = stored.sessionId;
    console.log(`[Kashier] Resolved orderId=${id} → sessionId=${sessionId}`);
  } else {
    console.log(`[Kashier] No stored session found for orderId=${id}`);
  }

  const base = getKashierBaseUrl();
  const url = `${base}/v3/payment/sessions/${encodeURIComponent(sessionId)}/payment`;

  try {
    console.log('[Kashier] GET payment status', { sessionId, endpoint: url });

    const response = await axios.get(url, {
      headers: getKashierHeaders(),
      timeout: 30000,
    });

    const data = response.data?.data || response.data;
    const status = data?.status ?? null;
    const amount = data?.amount ?? null;
    const returnedSessionId = data?.sessionId || data?._id || sessionId;

    const normalizedStatus = status ? String(status).toUpperCase() : null;
    const paid = ['PAID', 'SUCCESS', 'CAPTURED'].includes(normalizedStatus);

    return { paid, status, amount: amount ? String(amount) : null, sessionId: returnedSessionId };
  } catch (err) {
    // معالجة أخطاء قوية: لا نرمي 500 عام، نرجّع حالة غير مدفوعة مع تفاصيل كاشير
    const kashierMsg =
      err.response?.data?.message ||
      err.response?.data?.error ||
      (typeof err.response?.data === 'string' ? err.response.data : null) ||
      err.message;
    console.error('Kashier inquiry error:', kashierMsg);
    return { paid: false, status: null, amount: null, sessionId: null };
  }
}

module.exports = {
  generateKashierCheckoutHash,
  createKashierSession,
  queryKashierTransaction,
  verifyWebhookSignature,
};
