const { getWalletBalance, getTransactions, requestWithdrawal, getWithdraws, topUpWallet, validateTopUp, listPaymentMethods, addPaymentMethod, deletePaymentMethod, setDefaultPaymentMethod } = require('../services/wallet.service');
const { createKashierSession, queryKashierTransaction, payWithWalletDirect, payWithCardDirect, isTopupOrderId, extractTopupUserId } = require('../services/kashier');
const prisma = require('../config/prisma');
const { getWalletLimits, DEFAULT_LIMITS } = require('../config/wallet.constants');

async function getWalletBalanceHandler(req, res) {
  try {
    const data = await getWalletBalance(req.user.userId);
    res.json(data);
  } catch (error) {
    console.error(error);
    // fallback آمن: نرجّع رصيد صفر بدل 500 (مع الحفاظ على حقول السياسة)
    res.json({
      balance: 0,
      pendingWithdraw: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      fullName: '',
      minBalance: DEFAULT_LIMITS.CAPTAIN_MIN_BALANCE,
      maxBalance: DEFAULT_LIMITS.CAPTAIN_MAX_BALANCE,
      minTopUp: DEFAULT_LIMITS.CAPTAIN_MIN_TOPUP,
      canAcceptRides: true,
      canWithdraw: false,
    });
  }
}

async function getTransactionsHandler(req, res) {
  try {
    const transactions = await getTransactions(req.user.userId);
    // fallback آمن: لو ما فيش محفظة/معاملات نرجّع مصفوفة فارغة بدل 500
    res.json({ transactions: transactions || [] });
  } catch (error) {
    console.error(error);
    // بديلاً عن رمي 500، نرجّع مصفوفة فارغة مع 200 حتى لا ينهار العميل
    res.json({ transactions: [] });
  }
}

async function requestWithdrawalHandler(req, res) {
  try {
    const withdraw = await requestWithdrawal(req.user.userId, req.body);
    res.status(201).json({ message: 'تم تقديم طلب السحب', withdraw });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في طلب السحب' });
  }
}

async function getWithdrawsHandler(req, res) {
  try {
    const withdraws = await getWithdraws(req.user.userId);
    res.json({ withdraws });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب طلبات السحب' });
  }
}

async function topUpWalletHandler(req, res) {
  try {
    const result = await topUpWallet(req.user.userId, req.body);
    if (result.paymentUrl) {
      return res.json({
        message: 'تم إنشاء رابط الدفع',
        paymentUrl: result.paymentUrl,
        sessionUrl: result.sessionUrl,
        sessionId: result.sessionId,
      });
    }
    res.json({ message: 'تم شحن المحفظة', balance: result.balance });
  } catch (error) {
    console.error(error);
    // رسائل التحقق من السياسة (الحد الأدنى/الأقصى) تُرجَع كـ 400 برسالة واضحة
    res.status(400).json({ error: error.message || 'خطأ في شحن المحفظة' });
  }
}

/**
 * POST /api/v1/wallet/initiate-payment
 * ينشئ جلسة دفع جديدة مع Kashier ويرجع Session ID للتطبيق.
 * التطبيق يفتح WebView بـ Session ID للدفع الآمن.
 */
async function initiatePaymentHandler(req, res) {
  try {
    const { amount, paymentMethod } = req.body;
    const userId = req.user?.userId;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'المستخدم غير مصرح' });
    }

    // التحقق من طريقة الدفع المدعومة
    const supportedMethods = ['card', 'vodafone_cash', 'instapay'];
    if (paymentMethod && !supportedMethods.includes(paymentMethod)) {
      return res.status(400).json({ error: 'طريقة الدفع غير مدعومة' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    // التحقق من سياسة محفظة الكابتن (الحد الأدنى للشحن + أقصى رصيد)
    try {
      await validateTopUp(userId, amount);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    // التحقق من اكتمال بيانات العميل قبل إرسالها لـ Kashier
    const phoneIsPlaceholder = (user.phoneNumber || '').startsWith('firebase:');
    if (!user.email || phoneIsPlaceholder) {
      return res.status(400).json({
        error: 'برجاء إكمال بيانات حسابك (البريد الإلكتروني ورقم الهاتف) قبل الشحن',
      });
    }

    const orderId = `topup_${userId}_${Date.now()}`;
    const session = await createKashierSession(
      orderId,
      amount,
      'شحن محفظة وصلني',
      paymentMethod,
      user
    );

    res.json({
      success: true,
      sessionId: session.sessionId,
      sessionUrl: session.sessionUrl,
      paymentUrl: session.paymentUrl,
      orderId: session.orderId,
      amount: session.amount,
      currency: session.currency,
      status: session.status,
    });
  } catch (error) {
    console.error('Initiate payment error:', error);
    res.status(500).json({ error: error.message || 'خطأ في إنشاء جلسة الدفع' });
  }
}

/**
 * GET /api/v1/wallet/kashier-checkout-page
 * يرسل صفحة HTML تحتوي على زرّ دفع كاشier (Checkout JS/Form) لشحن المحفظة.
 * يقبل amount و userId كـ query params.
 */
async function kashierCheckoutPageHandler(req, res) {
  try {
    const { amount, userId } = req.query;

    if (!amount || !userId) {
      return res.status(400).send('<h1 style="color:red;text-align:center;margin-top:50px;">❌ ناقص بيانات (amount أو userId)</h1>');
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).send('<h1 style="color:red;text-align:center;margin-top:50px;">❌ المبلغ غير صالح</h1>');
    }

    // نبحث بالـ id الداخلي أو firebaseUid (جوجل) لدعم كلا الحالتين
    const user = await prisma.user.findFirst({
      where: { OR: [ { id: userId }, { firebaseUid: userId } ] },
    });
    if (!user) {
      return res.status(404).send('<h1 style="color:red;text-align:center;margin-top:50px;">❌ المستخدم غير موجود</h1>');
    }

    // التحقق من سياسة محفظة الكابتن (الحد الأدنى للشحن + أقصى رصيد)
    try {
      await validateTopUp(user.id, amt);
    } catch (validationError) {
      return res
        .status(400)
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ ${validationError.message}</h1>`);
    }

    const merchantId = process.env.KASHIER_MID;
    const currency = 'EGP';
    const orderId = `topup_${userId}_${Date.now()}`;
    const formattedAmount = amt.toFixed(2);
    const hash = generateKashierCheckoutHash(orderId, amt, currency);
    const appUrl = process.env.APP_URL || `http://${req.get('host')}`;
    const backendCallbackUrl = `${appUrl}/api/v1/wallet/kashier-callback`;

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>شحن المحفظة - وصلني</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f7fa; margin: 0; padding: 24px; }
    .card { max-width: 420px; margin: 40px auto; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,.08); text-align: center; }
    h2 { color: #1a73e8; margin-bottom: 8px; }
    .amount { font-size: 32px; font-weight: bold; color: #222; margin: 16px 0; }
    .kashier-payment-btn { margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>شحن محفظة وصلني</h2>
    <p>المبلغ المطلوب شحنه</p>
    <div class="amount">${formattedAmount} ${currency}</div>
    <script
      id="kashier-iFrame"
      src="https://checkout.kashier.co/js/kashier-checkout.js"
      data-hash="${hash}"
      data-amount="${formattedAmount}"
      data-merchantId="${merchantId}"
      data-orderId="${orderId}"
      data-currency="${currency}"
      data-type="external"
      data-display="ar"
      data-callback="${backendCallbackUrl}?userId=${userId}"
      class="kashier-payment-btn">
    </script>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send('<h1 style="color:red;text-align:center;margin-top:50px;">❌ خطأ في الخادم</h1>');
  }
}

/**
 * GET /api/v1/wallet/kashier-callback
 * يعيد توجيهه كاشier بعد الدفع. يتحقق من الحالة ويحدّث رصيد المحفظة ثم يعرض صفحة نجاح/فشل.
 */
async function kashierCallbackHandler(req, res) {
  try {
    const { userId, status, orderId, merchantOrderId, paymentStatus, sessionId } = req.query;

    // كاشير v3 بيرجّع sessionId في الـ redirect — نربطه بـ orderId عبر جدول paymentSession
    let resolvedOrderId = (typeof orderId === 'string' && orderId) || (typeof merchantOrderId === 'string' && merchantOrderId) || null;
    if (!resolvedOrderId && typeof sessionId === 'string') {
      const stored = await prisma.paymentSession.findFirst({ where: { sessionId } });
      if (stored && typeof stored.orderId === 'string') resolvedOrderId = stored.orderId;
    }

    // استنتاج userId من بادئة orderId (TOPUP_ أو topup_ يتبعه userId)
    let resolvedUserId = typeof userId === 'string' ? userId : null;
    if (!resolvedUserId && typeof resolvedOrderId === 'string') {
      const upper = resolvedOrderId.toUpperCase();
      if (upper.startsWith('TOPUP_')) {
        // استخراج آمن: كل النص بين أول underscore وآخر underscore
        const firstUnderscore = resolvedOrderId.indexOf('_');
        const lastUnderscore = resolvedOrderId.lastIndexOf('_');
        resolvedUserId = firstUnderscore !== -1 && lastUnderscore > firstUnderscore
          ? resolvedOrderId.slice(firstUnderscore + 1, lastUnderscore)
          : resolvedOrderId.split('_')[1];
      }
    }

    if (!resolvedUserId || !resolvedOrderId) {
      return res
        .status(400)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ فشل الدفع</h1>
          <p style="text-align:center;">لم يتم تأكيد العملية، يرجى المحاولة مرة أخرى.</p>`);
    }

    let remote = await queryKashierTransaction(resolvedOrderId);
    let credited = false;
    if (!remote?.paid) {
      const stored = await prisma.paymentSession.findFirst({ where: { orderId: resolvedOrderId } });
      if (stored?.sessionId) {
        remote = await queryKashierTransaction(stored.sessionId);
      }
    }

    if (!remote?.paid) {
      console.log(`[KashierCallback] ❌ Not credited orderId=${resolvedOrderId} userId=${resolvedUserId} credited=no`);
      return res
        .status(402)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ لم يتم تأكيد الدفع لدى البنك</h1>
          <p style="text-align:center;">يرجى المحاولة لاحقاً أو التواصل مع الدعم.</p>`);
    }

    const already = await prisma.walletTransaction.findFirst({
      where: { type: 'TOPUP', metadata: { path: ['orderId'], equals: resolvedOrderId } },
    });
    if (already) {
      credited = true;
      console.log(`[KashierCallback] ✅ Already credited orderId=${resolvedOrderId} userId=${resolvedUserId} credited=yes`);
      return res
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:green;text-align:center;margin-top:50px;">✅ تم شحن المحفظة بنجاح</h1>
          <p style="text-align:center;">تم تأكيد العملية مسبقاً.</p>`);
    }

    const walletUser = await prisma.user.findFirst({
      where: { OR: [ { id: resolvedUserId }, { firebaseUid: resolvedUserId } ] },
    });
    if (!walletUser) {
      return res
        .status(404)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ المستخدم غير موجود</h1>`);
    }

    const limits = await getWalletLimits();
    const existingWallet = await prisma.wallet.findUnique({
      where: { userId: walletUser.id },
    });
    const currentBalance = existingWallet ? parseFloat(existingWallet.balance.toString()) : 0;
    const topUpAmount = Number(remote.amount || 0);
    if (currentBalance + topUpAmount > limits.CAPTAIN_MAX_BALANCE) {
      return res
        .status(400)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ لا يمكن أن يتجاوز رصيد المحفظة ${limits.CAPTAIN_MAX_BALANCE} ج.م</h1>`);
    }

    const { wallet } = await prisma.$transaction(async (tx) => {
      const w = await tx.wallet.upsert({
        where: { userId: walletUser.id },
        update: { balance: { increment: topUpAmount } },
        create: { userId: walletUser.id, balance: topUpAmount },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: 'TOPUP',
          amount: topUpAmount,
          balanceAfter: w.balance,
          description: 'شحن المحفظة عبر كاشير (Checkout)',
          status: 'COMPLETED',
          metadata: { orderId: resolvedOrderId, method: 'kashier-checkout', sessionId: remote.sessionId || null },
        },
      });
      return { wallet: w };
    });

    credited = true;
    console.log(`[KashierCallback] ✅ Credited orderId=${resolvedOrderId} userId=${resolvedUserId} amount=${topUpAmount} newBalance=${wallet.balance} credited=yes`);
    res
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(`<h1 style="color:green;text-align:center;margin-top:50px;">✅ تم شحن المحفظة بنجاح</h1>
        <p style="text-align:center;">تمت إضافة الرصيد إلى محفظتك.</p>`);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ خطأ في الخادم</h1>
        <p style="text-align:center;">حدث خطأ أثناء تأكيد الدفع.</p>`);
  }
}

/**
 * POST /api/v1/wallet/topup/initiate
 * ينشئ جلسة دفع جديدة مع Kashier ويعيد رابط صفحة الدفع المستضافة (Hosted Checkout).
 * الفرونت إند يفتح الرابط في WebView ليكمل المستخدم الدفع.
 */
async function initiateTopUp(req, res) {
  try {
    const { amount } = req.body;
    const userId = req.user?.userId;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    }
    if (!userId) {
      return res.status(401).json({ error: 'المستخدم غير مصرح' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    // التحقق من سياسة محفظة الكابتن (الحد الأدنى للشحن + أقصى رصيد)
    try {
      await validateTopUp(userId, amount);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const orderId = `TOPUP_${userId}_${Date.now()}`;

    // إنشاء جلسة دفع Kashier — تُعيد رابط الصفحة المستضافة (sessionUrl)
    const session = await createKashierSession(
      orderId,
      amount,
      'شحن محفظة وصلني',
      'card,wallet', // يقبل بطاقة ومحفظة إلكترونية
      user
    );

    return res.status(201).json({
      success: true,
      message: 'تم إنشاء جلسة الدفع بنجاح',
      orderId,
      checkoutUrl: session.sessionUrl, // الرابط المطلوب لفتحه في WebView
      sessionId: session.sessionId,
      amount: session.amount,
      currency: session.currency,
      status: session.status,
    });
  } catch (error) {
    console.error('Initiate topup error:', error);
    return res.status(500).json({ error: error.message || 'حدث خطأ أثناء إنشاء جلسة الدفع' });
  }
}

/**
 * POST /api/v1/wallet/topup/confirm
 * يؤكد عملية الدفع مع Kashier ويشحن محفظة المستخدم.
 */
async function confirmTopUp(req, res) {
  try {
    const { orderId, sessionId } = req.body || req.query || {};

    if (!orderId) {
      return res.status(400).json({ error: 'معرّف الطلب (orderId) مطلوب' });
    }

    const paymentSession = await prisma.paymentSession.findUnique({ where: { orderId } });
    if (!paymentSession) {
      return res.status(404).json({ error: 'لم يتم العثور على جلسة الدفع' });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'المستخدم غير مصرح' });
    }

    const topupUserId = extractTopupUserId(orderId) || userId;
    const topupOrderId = orderId;

    let paymentStatus = null;
    let paymentStatusSource = 'db';
    const paymentSessionId = sessionId || paymentSession.sessionId || null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const statusResult = await queryKashierTransaction(paymentSessionId || orderId);
      if (statusResult?.paid || statusResult?.status) {
        paymentStatus = statusResult;
        paymentStatusSource = paymentSessionId ? 'kashier-session' : 'kashier-order';
        break;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    const alreadyCredited = await prisma.walletTransaction.findFirst({
      where: { type: 'TOPUP', metadata: { path: ['orderId'], equals: topupOrderId } },
    });

    if (alreadyCredited) {
      console.log(`[ConfirmTopUp] ✅ Already credited orderId=${topupOrderId} userId=${topupUserId}`);
      return res.json({ success: true, message: 'تمت معالجة هذه العملية مسبقاً', alreadyCredited: true });
    }

    if (paymentStatus?.paid) {
      const amount = Number(paymentSession.amount || paymentStatus.amount || 0);
      if (amount <= 0) {
        return res.status(400).json({ error: 'المبلغ غير صالح' });
      }

      const limits = await getWalletLimits();
      const existingWallet = await prisma.wallet.findUnique({ where: { userId: topupUserId } });
      const currentBalance = existingWallet ? parseFloat(existingWallet.balance.toString()) : 0;
      if (currentBalance + amount > limits.CAPTAIN_MAX_BALANCE) {
        return res.status(400).json({ error: `لا يمكن أن يتجاوز رصيد المحفظة ${limits.CAPTAIN_MAX_BALANCE} ج.م` });
      }

      const wallet = await prisma.$transaction(async (tx) => {
        const w = await tx.wallet.upsert({
          where: { userId: topupUserId },
          update: { balance: { increment: amount } },
          create: { userId: topupUserId, balance: amount },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: w.id,
            type: 'TOPUP',
            amount,
            balanceAfter: w.balance,
            status: 'COMPLETED',
            description: 'شحن محفظة عبر Kashier',
            metadata: {
              orderId: topupOrderId,
              sessionId: paymentSession.sessionId,
              paymentReference: paymentStatus.sessionId || null,
              confirmedBy: 'confirmTopUp',
            },
          },
        });
        await tx.paymentSession.updateMany({
          where: { orderId: topupOrderId },
          data: { status: 'SUCCESS', paymentReference: paymentStatus.sessionId || null, confirmedAt: new Date(), updatedAt: new Date() },
        });
        return w;
      });

      console.log(`[ConfirmTopUp] ✅ Credited orderId=${topupOrderId} userId=${topupUserId} amount=${amount} source=${paymentStatusSource} credited=yes`);
      return res.json({ success: true, message: 'تم شحن المحفظة بنجاح', balance: Number(wallet.balance), amount });
    }

    const failureReason = paymentStatus?.status ? `حالة الدفع: ${paymentStatus.status}` : 'لم يكتمل الدفع';
    await prisma.paymentSession.update({ where: { orderId }, data: { status: 'FAILED', failureReason, updatedAt: new Date() } });

    console.log(`[ConfirmTopUp] ❌ Not credited orderId=${topupOrderId} userId=${topupUserId} amount=${paymentSession.amount || 0} source=${paymentStatusSource} credited=no reason=${failureReason}`);
    return res.status(402).json({ success: false, error: 'لم يكتمل الدفع', failureReason });
  } catch (error) {
    console.error('Confirm topup error:', error);
    res.status(500).json({ error: error.message || 'حدث خطأ أثناء تأكيد الدفع' });
  }
}

// ── Payment Methods (CRUD) ─────────────────────────────

async function listPaymentMethodsHandler(req, res) {
  try {
    const methods = await listPaymentMethods(req.user.userId);
    res.json({ paymentMethods: methods });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب طرق الدفع' });
  }
}

async function addPaymentMethodHandler(req, res) {
  try {
    const { type, label, accountNumber, bankName } = req.body;
    const method = await addPaymentMethod(req.user.userId, { type, label, accountNumber, bankName });
    res.status(201).json({ message: 'تم إضافة طريقة الدفع', paymentMethod: method });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في إضافة طريقة الدفع' });
  }
}

async function deletePaymentMethodHandler(req, res) {
  try {
    await deletePaymentMethod(req.user.userId, req.params.id);
    res.json({ message: 'تم حذف طريقة الدفع' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في حذف طريقة الدفع' });
  }
}

async function setDefaultPaymentMethodHandler(req, res) {
  try {
    const method = await setDefaultPaymentMethod(req.user.userId, req.params.id);
    res.json({ message: 'تم تعيين طريقة الدفع كافتراضية', paymentMethod: method });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في تعيين طريقة الدفع الافتراضية' });
  }
}

module.exports = { getWalletBalanceHandler, getTransactionsHandler, requestWithdrawalHandler, getWithdrawsHandler, topUpWalletHandler, initiatePaymentHandler, kashierCheckoutPageHandler, kashierCallbackHandler, initiateTopUp, confirmTopUp, listPaymentMethodsHandler, addPaymentMethodHandler, deletePaymentMethodHandler, setDefaultPaymentMethodHandler };
