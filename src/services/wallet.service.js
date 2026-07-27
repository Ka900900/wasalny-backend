const prisma = require('../config/prisma');
const { createKashierSession } = require('./kashier');
const { Prisma } = require('@prisma/client');

async function ensureWallet(userId, tx) {
  const db = tx || prisma;
  let wallet = await db.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await db.wallet.create({
      data: { userId, balance: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
    });
  }
  return wallet;
}

async function getWalletBalance(userId) {
  const wallet = await ensureWallet(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return {
    balance: wallet.balance,
    pendingWithdraw: wallet.pendingWithdraw,
    totalEarned: wallet.totalEarned,
    totalWithdrawn: wallet.totalWithdrawn,
    fullName: `${user.firstName} ${user.lastName}`,
  };
}

async function getTransactions(userId) {
  const wallet = await ensureWallet(userId);
  return prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 50 });
}

async function requestWithdrawal(userId, { amount, withdrawMethod, bankName, bankAccount, accountHolder, instapayId }) {
  const amt = new Prisma.Decimal(amount);
  const method = withdrawMethod || 'BANK';

  return prisma.$transaction(async (tx) => {
    // ضمان وجود المحفظة (إنشاؤها تلقائياً برصيد 0) لحل مشكلة الـ 404
    const wallet = await ensureWallet(userId, tx);

    const available = wallet.balance.minus(wallet.reservedAmount);
    if (available.lt(amt)) {
      throw new Error('الرصيد المتاح غير كافٍ لطلب السحب');
    }

    // بناء وصف المعاملة حسب طريقة السحب
    let description;
    if (method === 'INSTAPAY') {
      description = `طلب سحب ${amt.toString()} ج.م - InstaPay (${instapayId})`;
    } else {
      description = `طلب سحب ${amt.toString()} ج.م - ${bankName || ''}`;
    }

    const withdraw = await tx.withdrawRequest.create({
      data: {
        walletId: wallet.id,
        amount: amt,
        withdrawMethod: method,
        bankName: method === 'BANK' ? bankName : null,
        bankAccount: method === 'BANK' ? bankAccount : null,
        accountHolder: method === 'BANK' ? accountHolder : null,
        instapayId: method === 'INSTAPAY' ? instapayId : null,
        status: 'PENDING',
      },
    });

    const newReserved = wallet.reservedAmount.plus(amt);
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { reservedAmount: newReserved },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'WITHDRAWAL',
        amount: amt,
        balanceAfter: wallet.balance, // الرصيد الكلي لم يتغير (محجوز فقط)
        description,
        status: 'HELD',
        metadata: { withdrawRequestId: withdraw.id, withdrawMethod: method },
      },
    });

    return withdraw;
  });
}

async function getWithdraws(userId) {
  const wallet = await ensureWallet(userId);
  return prisma.withdrawRequest.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 50 });
}

async function topUpWallet(userId, { amount, paymentMethod }) {
  const parsedAmount = Number(amount);
  if (
    amount === null ||
    amount === undefined ||
    Number.isNaN(parsedAmount) ||
    parsedAmount <= 0
  ) {
    throw new Error('المبلغ غير صالح');
  }

  // رفض طرق الدفع غير المدعومة
  const supportedMethods = ['card', 'vodafone_cash', 'instapay'];
  if (paymentMethod && !supportedMethods.includes(paymentMethod)) {
    throw new Error('طريقة الدفع غير مدعومة');
  }

  const amt = new Prisma.Decimal(parsedAmount);

  // كل طرق الدفع التي تمر عبر كاشير (بطاقة، محفظة إلكترونية، إنستاباي)
  const kashierMethods = ['card', 'vodafone_cash', 'instapay'];

  if (kashierMethods.includes(paymentMethod)) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const session = await createKashierSession(
      `topup_${userId}_${Date.now()}`,
      parsedAmount,
      'شحن محفظة وصلني',
      paymentMethod,
      user
    );
    return { paymentUrl: session.paymentUrl, sessionId: session.sessionId, sessionUrl: session.sessionUrl };
  }

  const wallet = await ensureWallet(userId);
  await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amt } } });
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'TOPUP',
      amount: amt,
      description: 'شحن المحفظة',
      status: 'COMPLETED',                   // ← explicit, as requested
    },
  });

  return { balance: wallet.balance.plus(amt).toString() };
}

// ── إدارة الأدمن لطلبات السحب (يدوي) ──
async function listWithdrawals({ status } = {}) {
  const where = status ? { status } : {};
  return prisma.withdrawRequest.findMany({
    where,
    include: { wallet: { select: { id: true, userId: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function approveWithdrawal(id) {
  return prisma.$transaction(async (tx) => {
    const w = await tx.withdrawRequest.findUnique({ where: { id } });
    if (!w) throw new Error('طلب السحب غير موجود');
    if (w.status !== 'PENDING') throw new Error('لا يمكن الموافقة على طلب بهذه الحالة');
    return tx.withdrawRequest.update({ where: { id }, data: { status: 'APPROVED' } });
  });
}

async function rejectWithdrawal(id, reason) {
  return prisma.$transaction(async (tx) => {
    const w = await tx.withdrawRequest.findUnique({ where: { id } });
    if (!w) throw new Error('طلب السحب غير موجود');
    if (w.status !== 'PENDING' && w.status !== 'APPROVED') {
      throw new Error('لا يمكن رفض طلب بهذه الحالة');
    }
    const wallet = await tx.wallet.findUnique({ where: { id: w.walletId } });
    const newReserved = wallet.reservedAmount.minus(w.amount);
    await tx.wallet.update({ where: { id: wallet.id }, data: { reservedAmount: newReserved } });
    const updated = await tx.withdrawRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason || null },
    });
    await tx.walletTransaction.updateMany({
      where: { type: 'WITHDRAWAL', metadata: { path: ['withdrawRequestId'], equals: id } },
      data: { status: 'RELEASED' },
    });
    return updated;
  });
}

async function completeWithdrawal(id) {
  return prisma.$transaction(async (tx) => {
    const w = await tx.withdrawRequest.findUnique({ where: { id } });
    if (!w) throw new Error('طلب السحب غير موجود');
    if (w.status !== 'APPROVED') throw new Error('لا يمكن إتمام طلب غير موافق عليه');
    const wallet = await tx.wallet.findUnique({ where: { id: w.walletId } });
    if (!wallet) throw new Error('المحفظة غير موجودة');
    if (wallet.balance.lt(w.amount)) throw new Error('رصيد المحفظة غير كافٍ لإتمام السحب');
    const newBalance = wallet.balance.minus(w.amount);
    const newReserved = wallet.reservedAmount.minus(w.amount);
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance, reservedAmount: newReserved, totalWithdrawn: { increment: w.amount } },
    });
    const updated = await tx.withdrawRequest.update({
      where: { id },
      data: { status: 'COMPLETED', paidAt: new Date() },
    });
    await tx.walletTransaction.updateMany({
      where: { type: 'WITHDRAWAL', metadata: { path: ['withdrawRequestId'], equals: id } },
      data: { status: 'COMPLETED', balanceAfter: newBalance },
    });
    return updated;
  });
}

// ── Payment Methods CRUD ──────────────────────────────

async function listPaymentMethods(userId) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return [];
  return prisma.paymentMethod.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' } });
}

async function addPaymentMethod(userId, { type, label, accountNumber, bankName }) {
  const wallet = await ensureWallet(userId);

  // إذا كانت أول طريقة دفع → اجعلها افتراضية تلقائياً
  const existingCount = await prisma.paymentMethod.count({ where: { walletId: wallet.id } });
  const isDefault = existingCount === 0;

  return prisma.paymentMethod.create({
    data: {
      walletId: wallet.id,
      type,
      label: label || null,
      accountNumber: accountNumber || null,
      bankName: bankName || null,
      isDefault,
    },
  });
}

async function deletePaymentMethod(userId, methodId) {
  const wallet = await ensureWallet(userId);
  const method = await prisma.paymentMethod.findFirst({
    where: { id: methodId, walletId: wallet.id },
  });
  if (!method) throw new Error('طريقة الدفع غير موجودة');
  await prisma.paymentMethod.delete({ where: { id: methodId } });
  return { message: 'تم حذف طريقة الدفع' };
}

async function setDefaultPaymentMethod(userId, methodId) {
  const wallet = await ensureWallet(userId);
  const method = await prisma.paymentMethod.findFirst({
    where: { id: methodId, walletId: wallet.id },
  });
  if (!method) throw new Error('طريقة الدفع غير موجودة');

  return prisma.$transaction(async (tx) => {
    // إلغاء الافتراضي من جميع الطرق
    await tx.paymentMethod.updateMany({
      where: { walletId: wallet.id },
      data: { isDefault: false },
    });
    // تعيين الطريقة المطلوبة كافتراضية
    return tx.paymentMethod.update({
      where: { id: methodId },
      data: { isDefault: true },
    });
  });
}

module.exports = {
  ensureWallet, getWalletBalance, getTransactions, requestWithdrawal, getWithdraws, topUpWallet,
  listWithdrawals, approveWithdrawal, rejectWithdrawal, completeWithdrawal,
  listPaymentMethods, addPaymentMethod, deletePaymentMethod, setDefaultPaymentMethod,
};
