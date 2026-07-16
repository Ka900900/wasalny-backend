const {
  listWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal,
} = require('../services/wallet.service');

async function listWithdrawalsHandler(req, res) {
  try {
    const { status } = req.query;
    const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'];
    const filter = status && allowed.includes(status) ? { status } : {};
    const withdrawals = await listWithdrawals(filter);
    res.json({ withdrawals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب طلبات السحب' });
  }
}

async function approveWithdrawalHandler(req, res) {
  try {
    const w = await approveWithdrawal(req.params.id);
    res.json({ message: 'تمت الموافقة على طلب السحب', withdrawal: w });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في الموافقة على الطلب' });
  }
}

async function rejectWithdrawalHandler(req, res) {
  try {
    const { rejectReason } = req.body;
    const w = await rejectWithdrawal(req.params.id, rejectReason);
    res.json({ message: 'تم رفض طلب السحب', withdrawal: w });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في رفض الطلب' });
  }
}

async function completeWithdrawalHandler(req, res) {
  try {
    const w = await completeWithdrawal(req.params.id);
    res.json({ message: 'تم إتمام تحويل السحب', withdrawal: w });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في إتمام السحب' });
  }
}

module.exports = {
  listWithdrawalsHandler,
  approveWithdrawalHandler,
  rejectWithdrawalHandler,
  completeWithdrawalHandler,
};
