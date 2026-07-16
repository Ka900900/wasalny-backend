const { getWalletBalance, getTransactions, requestWithdrawal, getWithdraws, topUpWallet } = require('../services/wallet.service');

async function getWalletBalanceHandler(req, res) {
  try {
    const data = await getWalletBalance(req.user.userId);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب رصيد المحفظة' });
  }
}

async function getTransactionsHandler(req, res) {
  try {
    const transactions = await getTransactions(req.user.userId);
    res.json({ transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب المعاملات' });
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
