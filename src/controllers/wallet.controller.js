const { getWalletBalance, getTransactions, requestWithdrawal, getWithdraws, topUpWallet } = require('../services/wallet.service');

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
      return res.json({ message: 'تم إنشاء رابط الدفع', paymentUrl: result.paymentUrl, sessionId: result.sessionId });
    }
    res.json({ message: 'تم شحن المحفظة', balance: result.balance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في شحن المحفظة' });
  }
}

module.exports = { getWalletBalanceHandler, getTransactionsHandler, requestWithdrawalHandler, getWithdrawsHandler, topUpWalletHandler };
