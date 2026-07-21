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

  // خريطة طريقة الدفع → الـ allowedMethods المقبولة من Kashier
  // card      → بطاقة ائتمان/خصم فقط
  // vodafone_cash / instapay / wallet → محافظ إلكترونية فقط
  const method = (paymentMethod || 'card').toLowerCase();
  let allowedMethods = 'card,wallet'; // الافتراضي: الاتنين
  if (method === 'card') {
    allowedMethods = 'card';
  } else if (method === 'vodafone_cash' || method === 'instapay' || method === 'wallet') {
    allowedMethods = 'wallet';
  }

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
    allowedMethods,
    description: (description || '').toString().slice(0, 119),
    metaData: { source: 'wasalny', orderId, paymentMethod: method },
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
 * يُستخدم في webhook الخاص بـ index.js.
 *
 * ملاحظة مهمة (Kashier v3):
 * حسب التوثيق الرسمي، التوقيع يُحسب باستخدام API_KEY (وليس SECRET_KEY).
 * لذلك نحسب التوقيع بكلا المفتاحين ونسجّل النتائج للتشخيص.
 *
 * @param {string} payload   الجسم الخام للطلب (Raw JSON string)
 * @param {string} signature التوقيع القادم من ترويسة x-kashier-signature
 * @returns {boolean} true إذا تطابق أحد التوقيعين المحسوبين مع القادم
 */
function verifyWebhookSignature(payload, signature) {
  const apiKey = process.env.KASHIER_API_KEY || '';
  const secretKey = process.env.KASHIER_SECRET_KEY || '';

  // حساب التوقيع باستخدام API_KEY (الطريقة الصحيحة في v3)
  const withApiKey = crypto
    .createHmac('sha256', apiKey)
    .update(payload)
    .digest('hex');

  // حساب التوقيع باستخدام SECRET_KEY (قديم / بديل)
  const withSecretKey = crypto
    .createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');

  // طباعة تفاصيل التشخيص
  console.log('========== 🔐 Kashier Webhook Verification ==========');
  console.log('[Kashier] Incoming signature from header:', signature);
  console.log('[Kashier] Computed with API_KEY    :', withApiKey);
  console.log('[Kashier] Computed with SECRET_KEY :', withSecretKey);
  console.log('[Kashier] Payload (first 200 chars):', payload.slice(0, 200));
  console.log('[Kashier] API_KEY present         :', !!apiKey);
  console.log('[Kashier] SECRET_KEY present      :', !!secretKey);
  console.log('=====================================================');

  // نقارن مع API_KEY أولاً (الأحدث)، ثم SECRET_KEY (احتياطي)
  if (signature === withApiKey) {
    console.log('[Kashier] ✅ Signature match using API_KEY');
    return true;
  }
  if (signature === withSecretKey) {
    console.log('[Kashier] ✅ Signature match using SECRET_KEY');
    return true;
  }

  console.log('[Kashier] ❌ Signature does NOT match either key');
  return false;
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

/**
 * الدفع المباشر عبر محفظة إلكترونية (Vodafone Cash / InstaPay).
 * Kashier Direct Wallet Integration — يُستخدم عندما يختار المستخدم الدفع بالمحفظة.
 *
 * @param {object} params
 * @param {string} params.orderId         معرف الطلب الفريد
 * @param {number|string} params.amount   المبلغ
 * @param {string} params.walletPhoneNumber رقم هاتف المحفظة (مثال: 01012345678)
 * @param {string} [params.walletType]    نوع المحفظة: 'vodafone_cash' | 'instapay' (اختياري)
 * @param {string} [params.currency='EGP']
 *
 * @returns {{
 *   success: boolean,
 *   sessionId: string,
 *   referenceNumber: string|null,      // رقم مرجع الدفع من كاشير
 *   otpRequired: boolean,              // هل يحتاج تأكيد OTP
 *   message: string,
 *   orderId: string,
 *   amount: string,
 *   currency: string,
 *   status: string
 * }}
 */

/**
 * يولّد توقيع HMAC-SHA256 للدفع المباشر بالمحفظة.
 * الصيغة: "mid={mid}&orderId={orderId}&amount={amount}&currency={currency}"
 * (بعض إصدارات Kashier تتضمن walletPhoneNumber في الـ payload)
 */
function generateWalletDirectHash(orderId, amount, currency = 'EGP') {
  const mid = process.env.KASHIER_MID;
  const secret = process.env.KASHIER_SECRET_KEY;
  const formattedAmount = Number(amount).toFixed(2);
  const payload = `mid=${mid}&orderId=${orderId}&amount=${formattedAmount}&currency=${currency}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function payWithWalletDirect({ orderId, amount, walletPhoneNumber, walletType, currency = 'EGP' }) {
  const mid = process.env.KASHIER_MID;
  const secretKey = process.env.KASHIER_SECRET_KEY;
  const apiKey = process.env.KASHIER_API_KEY;
  const mode = (process.env.KASHIER_MODE || 'live').toLowerCase();
  const appUrl = process.env.APP_URL || 'https://wasalny-backend-production.up.railway.app';

  // التحقق من صحة المبلغ
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('المبلغ غير صالح: يجب أن يكون رقماً موجباً');
  }
  const formattedAmount = numericAmount.toFixed(2);

  // التحقق من رقم الهاتف
  if (!walletPhoneNumber || !/^01[0-9]{9}$/.test(walletPhoneNumber.replace(/[^0-9]/g, ''))) {
    throw new Error('رقم الهاتف غير صالح: يجب أن يكون رقماً مصرياً صحيحاً (مثال: 01012345678)');
  }
  const cleanPhone = walletPhoneNumber.replace(/[^0-9]/g, '');

  const missingConfig = [];
  if (!mid) missingConfig.push('KASHIER_MID');
  if (!secretKey) missingConfig.push('KASHIER_SECRET_KEY');
  if (!apiKey) missingConfig.push('KASHIER_API_KEY');
  if (!appUrl) missingConfig.push('APP_URL');
  if (missingConfig.length) {
    throw new Error(`Kashier configuration missing: ${missingConfig.join(', ')}`);
  }

  // توليد التوقيع
  const hash = generateWalletDirectHash(orderId, formattedAmount, currency);

  // تحديد نوع المحفظة (افتراضي: vodafone_cash)
  const wallet = (walletType || 'vodafone_cash').toLowerCase();

  const requestBody = {
    merchantId: mid,
    orderId,
    amount: formattedAmount,
    currency,
    walletPhoneNumber: cleanPhone,
    wallet,
    hash,
    serverWebhook: `${appUrl}/api/webhooks/kashier`,
    metaData: { source: 'wasalny', orderId, paymentMethod: 'wallet', walletPhoneNumber: cleanPhone },
  };

  // نقطة النهاية الخاصة بالدفع المباشر بالمحفظة (حسب توثيق Kashier)
  const endpoint = `${getKashierBaseUrl()}/v3/payment/wallet/pay`;

  let response;
  try {
    console.log('[Kashier] Direct Wallet POST request', {
      endpoint,
      headers: { 'Content-Type': 'application/json', Authorization: '[REDACTED]', 'api-key': '[REDACTED]' },
      body: { ...requestBody, hash: '[REDACTED]' },
    });

    response = await axios.post(endpoint, requestBody, {
      headers: getKashierHeaders(),
      timeout: 30000,
    });

    console.log('[Kashier] Direct Wallet POST response', {
      status: response?.status,
      body: response?.data,
    });
  } catch (err) {
    console.error('[Kashier] Direct Wallet POST failed', {
      status: err.response?.status,
      body: err.response?.data,
    });

    const kashierMsg =
      err.response?.data?.message ||
      err.response?.data?.error ||
      (typeof err.response?.data === 'string' ? err.response.data : null) ||
      err.message;
    throw new Error(`Kashier direct wallet failed: ${kashierMsg}`);
  }

  const data = response.data;

  // حفظ جلسة الدفع في قاعدة البيانات
  const sessionId = data?.sessionId || data?._id || `wallet_${orderId}`;
  await prisma.paymentSession.upsert({
    where: { orderId },
    update: {
      sessionId,
      status: data?.status || 'PENDING_OTP',
      paymentMethod: `wallet_${wallet}`,
      amount: formattedAmount,
      updatedAt: new Date(),
    },
    create: {
      orderId,
      sessionId,
      status: data?.status || 'PENDING_OTP',
      paymentMethod: `wallet_${wallet}`,
      amount: formattedAmount,
    },
  });
  console.log(`[Kashier] Direct wallet session saved: orderId=${orderId} → sessionId=${sessionId}`);

  return {
    success: true,
    sessionId,
    referenceNumber: data?.referenceNumber || data?.reference || null,
    otpRequired: data?.otpRequired !== false, // افتراضي true
    message: data?.message || 'تم إرسال طلب الدفع، يرجى تأكيد الـ OTP من هاتفك',
    orderId,
    amount: formattedAmount,
    currency,
    status: data?.status || 'PENDING_OTP',
  };
}

/**
 * الدفع المباشر بالبطاقة (Direct Card Payment) — Customized Card Form.
 * Kashier Direct Card API — يُستخدم عندما يريد التطبيق تمرير بيانات البطاقة مباشرة
 * (أو توكن البطاقة) بدون إعادة توجيه المستخدم إلى صفحة Kashier.
 *
 * نقطة النهاية: POST /v3/payments/card
 *
 * @param {object} params
 * @param {string} params.orderId         معرف الطلب الفريد
 * @param {number|string} params.amount   المبلغ
 * @param {string} params.currency        العملة (افتراضي EGP)
 * @param {string} [params.cardToken]     توكن البطاقة المخزنة (إن وُجد)
 * @param {object} [params.cardData]      بيانات البطاقة إن لم يكن هناك توكن:
 * @param {string} [params.cardData.number]       رقم البطاقة
 * @param {string} [params.cardData.expiryMonth]   شهر انتهاء الصلاحية (mm)
 * @param {string} [params.cardData.expiryYear]    سنة انتهاء الصلاحية (yyyy)
 * @param {string} [params.cardData.cvv]           رمز CVV
 * @param {string} [params.cardData.cardholderName] اسم حامل البطاقة
 * @param {object} [params.customer]      بيانات العميل { firstName, lastName, email, phoneNumber }
 * @param {string} [params.description]   وصف العملية
 *
 * @returns {{
 *   success: boolean,
 *   sessionId: string,
 *   transactionId: string|null,
 *   status: string,           // 'SUCCESS' | 'PENDING_3DS' | 'FAILED'
 *   3dsUrl: string|null,      // رابط 3D Secure (إن تطلب الأمر)
 *   message: string,
 *   orderId: string,
 *   amount: string,
 *   currency: string,
 * }}
 */

/**
 * يولّد توقيع HMAC-SHA256 للدفع المباشر بالبطاقة.
 * الصيغة المتوقعة من Kashier:
 *   "mid={mid}&orderId={orderId}&amount={amount}&currency={currency}&cardToken={cardToken}"
 * أو "mid={mid}&orderId={orderId}&amount={amount}&currency={currency}" (بدون توكن).
 */
function generateCardDirectHash(orderId, amount, currency = 'EGP', cardToken) {
  const mid = process.env.KASHIER_MID;
  const secret = process.env.KASHIER_SECRET_KEY;
  const formattedAmount = Number(amount).toFixed(2);
  let payload = `mid=${mid}&orderId=${orderId}&amount=${formattedAmount}&currency=${currency}`;
  if (cardToken) {
    payload += `&cardToken=${cardToken}`;
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function payWithCardDirect({ orderId, amount, currency = 'EGP', cardToken, cardData, customer, description }) {
  const mid = process.env.KASHIER_MID;
  const secretKey = process.env.KASHIER_SECRET_KEY;
  const apiKey = process.env.KASHIER_API_KEY;
  const appUrl = process.env.APP_URL || 'https://wasalny-backend-production.up.railway.app';

  // التحقق من صحة المبلغ
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('المبلغ غير صالح: يجب أن يكون رقماً موجباً');
  }
  const formattedAmount = numericAmount.toFixed(2);

  // يجب توفير إما cardToken أو cardData
  if (!cardToken && !cardData) {
    throw new Error('يجب توفير توكن البطاقة (cardToken) أو بيانات البطاقة (cardData)');
  }

  const missingConfig = [];
  if (!mid) missingConfig.push('KASHIER_MID');
  if (!secretKey) missingConfig.push('KASHIER_SECRET_KEY');
  if (!apiKey) missingConfig.push('KASHIER_API_KEY');
  if (!appUrl) missingConfig.push('APP_URL');
  if (missingConfig.length) {
    throw new Error(`Kashier configuration missing: ${missingConfig.join(', ')}`);
  }

  const hash = generateCardDirectHash(orderId, formattedAmount, currency, cardToken);

  const requestBody = {
    merchantId: mid,
    orderId,
    amount: formattedAmount,
    currency,
    hash,
    description: (description || '').toString().slice(0, 119),
    serverWebhook: `${appUrl}/api/webhooks/kashier`,
    metaData: { source: 'wasalny', orderId, paymentMethod: 'card_direct' },
  };

  // إما توكن البطاقة أو بيانات البطاقة
  if (cardToken) {
    requestBody.cardToken = cardToken;
  } else if (cardData) {
    requestBody.card = {
      number: cardData.number,
      expiryMonth: cardData.expiryMonth,
      expiryYear: cardData.expiryYear,
      cvv: cardData.cvv,
      cardholderName: cardData.cardholderName || '',
    };
  }

  if (customer) {
    requestBody.customer = {
      reference: customer.id || customer.firebaseUid || undefined,
      name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Wasalny User',
      email: customer.email || undefined,
      phone: customer.phoneNumber || undefined,
    };
  }

  const endpoint = `${getKashierBaseUrl()}/v3/payments/card`;

  let response;
  try {
    console.log('[Kashier] Direct Card POST request', {
      endpoint,
      headers: { 'Content-Type': 'application/json', Authorization: '[REDACTED]', 'api-key': '[REDACTED]' },
      body: { ...requestBody, hash: '[REDACTED]', card: requestBody.card ? '[PRESENT]' : undefined },
    });

    response = await axios.post(endpoint, requestBody, {
      headers: getKashierHeaders(),
      timeout: 30000,
    });

    console.log('[Kashier] Direct Card POST response', {
      status: response?.status,
      body: response?.data,
    });
  } catch (err) {
    console.error('[Kashier] Direct Card POST failed', {
      status: err.response?.status,
      body: err.response?.data,
    });

    const kashierMsg =
      err.response?.data?.message ||
      err.response?.data?.error ||
      (typeof err.response?.data === 'string' ? err.response.data : null) ||
      err.message;
    throw new Error(`Kashier direct card failed: ${kashierMsg}`);
  }

  const data = response.data;

  // حفظ جلسة الدفع في قاعدة البيانات
  const sessionId = data?.sessionId || data?._id || `card_${orderId}`;
  const transactionId = data?.transactionId || data?.transaction_id || null;
  const status = data?.status || (data?.threeDSecureUrl ? 'PENDING_3DS' : 'SUCCESS');

  await prisma.paymentSession.upsert({
    where: { orderId },
    update: {
      sessionId,
      status,
      paymentMethod: 'card_direct',
      amount: formattedAmount,
      updatedAt: new Date(),
    },
    create: {
      orderId,
      sessionId,
      status,
      paymentMethod: 'card_direct',
      amount: formattedAmount,
    },
  });
  console.log(`[Kashier] Direct card session saved: orderId=${orderId} → sessionId=${sessionId}, status=${status}`);

  return {
    success: status === 'SUCCESS' || status === 'PENDING_3DS',
    sessionId,
    transactionId,
    status,
    '3dsUrl': data?.threeDSecureUrl || data?.redirectUrl || null,
    message: data?.message || (status === 'PENDING_3DS' ? 'يرجى إكمال التحقق 3D Secure' : 'تمت عملية الدفع بنجاح'),
    orderId,
    amount: formattedAmount,
    currency,
  };
}

module.exports = {
  generateKashierCheckoutHash,
  createKashierSession,
  queryKashierTransaction,
  verifyWebhookSignature,
  payWithWalletDirect,
  payWithCardDirect,
};
