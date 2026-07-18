const { getWalletBalance, getTransactions, requestWithdrawal, getWithdraws, topUpWallet } = require('../services/wallet.service');
const { createKashierSession, queryKashierTransaction } = require('../services/kashier');
const prisma = require('../config/prisma');

async function getWalletBalanceHandler(req, res) {
  try {
    const data = await getWalletBalance(req.user.userId);
    res.json(data);
  } catch (error) {
    console.error(error);
    // fallback آمن: نرجّع رصيد صفر بدل 500
    res.json({
      balance: 0,
      pendingWithdraw: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      fullName: '',
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
    res.status(500).json({ error: 'خطأ في شحن المحفظة' });
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

    const orderId = `topup_${userId}_${Date.now()}`;
    const session = await createKashierSession(
      orderId,
      amount,
      'شحن محفظة وصلني'
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
    const { userId, status, orderId, merchantOrderId, paymentStatus } = req.query;
    const order = orderId || merchantOrderId;

    const success = status === 'success' || paymentStatus === 'PAID' || paymentStatus === 'success';

    if (!success || !userId || !order) {
      return res
        .status(400)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ فشل الدفع</h1>
          <p style="text-align:center;">لم يتم تأكيد العملية، يرجى المحاولة مرة أخرى.</p>`);
    }

    // منع الاحتساب المكرر لنفس العملية
    const already = await prisma.walletTransaction.findFirst({
      where: { type: 'TOPUP', metadata: { path: ['orderId'], equals: order } },
    });
    if (already) {
      return res
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:green;text-align:center;margin-top:50px;">✅ تم شحن المحفظة بنجاح</h1>
          <p style="text-align:center;">تم تأكيد العملية مسبقاً.</p>`);
    }

    // استعلام Server-side للتأكد قبل تحديث الرصيد
    const remote = await queryKashierTransaction(order);
    if (!remote?.paid) {
      return res
        .status(402)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ لم يتم تأكيد الدفع لدى البنك</h1>
          <p style="text-align:center;">يرجى المحاولة لاحقاً أو التواصل مع الدعم.</p>`);
    }

    // userId هنا قد يكون cuid أو firebaseUid — نحلّه لأول مستخدم مطابق
    const walletUser = await prisma.user.findFirst({
      where: { OR: [ { id: userId }, { firebaseUid: userId } ] },
    });
    if (!walletUser) {
      return res
        .status(404)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(`<h1 style="color:red;text-align:center;margin-top:50px;">❌ المستخدم غير موجود</h1>`);
    }

    // عملية ذرية: تحديث الرصيد + تسجيل المعاملة في نفس Prisma transaction
    const { wallet } = await prisma.$transaction(async (tx) => {
      const w = await tx.wallet.upsert({
        where: { userId: walletUser.id },
        update: { balance: { increment: remote.amount || 0 } },
        create: { userId: walletUser.id, balance: remote.amount || 0 },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: 'TOPUP',
          amount: remote.amount || 0,
          balanceAfter: w.balance,
          description: 'شحن المحفظة عبر كاشير (Checkout)',
          status: 'COMPLETED',
          metadata: { orderId: order, method: 'kashier-checkout' },
        },
      });
      return { wallet: w };
    });

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

module.exports = { getWalletBalanceHandler, getTransactionsHandler, requestWithdrawalHandler, getWithdrawsHandler, topUpWalletHandler, initiatePaymentHandler, kashierCheckoutPageHandler, kashierCallbackHandler };
