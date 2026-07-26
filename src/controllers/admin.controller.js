const prisma = require('../config/prisma');
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

// ═══════════════════════════════════════════════════════
//  CAPTAIN VERIFICATION HANDLERS
// ═══════════════════════════════════════════════════════

async function listPendingCaptainsHandler(req, res) {
  try {
    const pending = await prisma.driverProfile.findMany({
      where: { verificationStatus: 'PENDING' },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true, avatarUrl: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ captains: pending });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الكباتن المعلقين' });
  }
}

async function approveCaptainHandler(req, res) {
  try {
    const { userId } = req.params;
    const profile = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) {
      return res.status(404).json({ error: 'هذا الكابتن غير موجود' });
    }
    const updated = await prisma.driverProfile.update({
      where: { userId },
      data: { verificationStatus: 'APPROVED', rejectionReason: null },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.json({ message: 'تم اعتماد الكابتن بنجاح', driverProfile: updated });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في اعتماد الكابتن' });
  }
}

async function rejectCaptainHandler(req, res) {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const profile = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!profile) {
      return res.status(404).json({ error: 'هذا الكابتن غير موجود' });
    }
    const updated = await prisma.driverProfile.update({
      where: { userId },
      data: { verificationStatus: 'REJECTED', rejectionReason: reason || null },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.json({ message: 'تم رفض الكابتن', driverProfile: updated });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في رفض الكابتن' });
  }
}

module.exports = {
  listWithdrawalsHandler,
  approveWithdrawalHandler,
  rejectWithdrawalHandler,
  completeWithdrawalHandler,
  listPendingCaptainsHandler,
  approveCaptainHandler,
  rejectCaptainHandler,
};
