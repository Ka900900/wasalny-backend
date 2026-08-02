const prisma = require('../config/prisma');
const {
  listWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal,
} = require('../services/wallet.service');
const { sendSingleNotification } = require('../services/fcm.service');

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
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { user: { select: { fcmToken: true, firstName: true, lastName: true } } },
    });
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

    // إرسال إشعار للكابتن بقبول الطلب
    const captainName = `${profile.user.firstName} ${profile.user.lastName}`.trim();
    if (profile.user.fcmToken) {
      sendSingleNotification(
        profile.user.fcmToken,
        '✅ تم اعتماد حسابك',
        `مرحباً ${captainName}! تم اعتماد حساب الكابتن الخاص بك، يمكنك الآن البدء باستقبال الرحلات.`,
        { type: 'verification_approved' }
      ).catch((err) => console.error('❌ FCM approve notification failed:', err?.message));
    }

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
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { user: { select: { fcmToken: true, firstName: true, lastName: true } } },
    });
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

    // إرسال إشعار للكابتن برفض الطلب
    const captainName = `${profile.user.firstName} ${profile.user.lastName}`.trim();
    if (profile.user.fcmToken) {
      sendSingleNotification(
        profile.user.fcmToken,
        '❌ لم يتم اعتماد حسابك',
        reason
          ? `عذراً ${captainName}، لم يتم اعتماد حسابك بسبب: ${reason}`
          : `عذراً ${captainName}، لم يتم اعتماد حسابك. يرجى مراجعة المستندات المرفوعة والمحاولة مرة أخرى.`,
        { type: 'verification_rejected' }
      ).catch((err) => console.error('❌ FCM reject notification failed:', err?.message));
    }

    res.json({ message: 'تم رفض الكابتن', driverProfile: updated });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في رفض الكابتن' });
  }
}

// ═══════════════════════════════════════════════════════
//  قائمة جميع الكباتن مع إمكانية التصفية حسب الحالة
// ═══════════════════════════════════════════════════════
async function listAllCaptainsHandler(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // بناء شرط التصفية
    const allowedStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
    const where = {};
    if (status && allowedStatuses.includes(status.toUpperCase())) {
      where.verificationStatus = status.toUpperCase();
    }

    // جلب العدد الكلي والصفحة الحالية
    const [total, captains] = await Promise.all([
      prisma.driverProfile.count({ where }),
      prisma.driverProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
              email: true,
              avatarUrl: true,
              isActive: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    res.json({
      captains,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب قائمة الكباتن' });
  }
}

// ═══════════════════════════════════════════════════════
//  عرض تفاصيل كابتن محدّد (للمسؤول)
// ═══════════════════════════════════════════════════════
async function getCaptainDetailsHandler(req, res) {
  try {
    const { userId } = req.params;
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true,
            avatarUrl: true,
            isActive: true,
            isVerified: true,
            fcmToken: true,
            createdAt: true,
            updatedAt: true,
            ridesAsDriver: {
              where: { status: 'COMPLETED' },
              select: { id: true },
            },
            wallet: {
              select: { balance: true, totalEarned: true, totalWithdrawn: true },
            },
          },
        },
      },
    });

    if (!profile) {
      return res.status(404).json({ error: 'هذا الكابتن غير موجود' });
    }

    // جلب بيانات المركبة المسجلة للكابتن
    const vehicle = await prisma.vehicle.findFirst({
      where: { userId },
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        color: true,
        plateNumber: true,
        vehicleType: true,
        licenseFrontUrl: true,
        licenseBackUrl: true,
      },
    });

    res.json({
      captain: {
        ...profile,
        vehicle,
        totalCompletedRides: profile.user.ridesAsDriver?.length || 0,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'خطأ في جلب بيانات الكابتن' });
  }
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD HANDLERS (لوحة تحكم وصلني)
// ═══════════════════════════════════════════════════════

// ── GET /api/v1/admin/stats ──────────────────────────
async function getAdminStatsHandler(req, res) {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalRides, onlineCaptains, todayRevenue, openTickets] = await Promise.all([
      prisma.rideRequest.count(),
      prisma.driverProfile.count({
        where: { isAvailable: true, verificationStatus: 'APPROVED' },
      }),
      prisma.rideRequest.aggregate({
        _sum: { price: true },
        where: { status: 'COMPLETED', paidAt: { gte: startOfToday } },
      }),
      prisma.supportTicket.count({
        where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
      }),
    ]);

    res.json({
      totalRides,
      onlineCaptains,
      todayRevenue: Number(todayRevenue._sum.price || 0),
      openTickets,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب إحصائيات لوحة التحكم' });
  }
}

// ── GET /api/v1/admin/rides?limit=8 ───────────────────
async function listRecentRidesHandler(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 50);
    const rides = await prisma.rideRequest.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        rider: { select: { firstName: true, lastName: true } },
        driver: { select: { firstName: true, lastName: true } },
      },
    });

    const mapped = rides.map((r) => ({
      id: r.id,
      riderName: `${r.rider?.firstName ?? ''} ${r.rider?.lastName ?? ''}`.trim(),
      captainName: r.driver ? `${r.driver.firstName} ${r.driver.lastName}`.trim() : null,
      from: r.pickupAddress || r.pickupPoint,
      to: r.destinationAddress || r.dropoffPoint,
      status: r.status,
      fare: Number(r.price) || 0,
      createdAt: r.createdAt,
    }));

    res.json(mapped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الرحلات الأخيرة' });
  }
}

// ── GET /api/v1/admin/analytics?range=today|7d|30d ───
async function getAnalyticsHandler(req, res) {
  try {
    const range = req.query.range || '7d';
    const now = new Date();
    const points = [];

    if (range === 'today') {
      // آخر 24 ساعة على شكل فترات ساعة
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const rides = await prisma.rideRequest.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true, price: true, status: true },
      });
      for (let i = 23; i >= 0; i--) {
        const hourStart = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
        const inRange = rides.filter((r) => r.createdAt >= hourStart && r.createdAt < hourEnd);
        points.push({
          label: hourStart.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          rides: inRange.length,
          revenue: Number(inRange.reduce((s, r) => s + (r.status === 'COMPLETED' ? Number(r.price) : 0), 0)),
        });
      }
    } else {
      const days = range === '30d' ? 30 : 7;
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (days - 1));
      const rides = await prisma.rideRequest.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true, price: true, status: true },
      });
      for (let i = 0; i < days; i++) {
        const dayStart = new Date(start);
        dayStart.setDate(start.getDate() + i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayStart.getDate() + 1);
        const inRange = rides.filter((r) => r.createdAt >= dayStart && r.createdAt < dayEnd);
        points.push({
          label: dayStart.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }),
          rides: inRange.length,
          revenue: Number(inRange.reduce((s, r) => s + (r.status === 'COMPLETED' ? Number(r.price) : 0), 0)),
        });
      }
    }

    res.json(points);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب بيانات التحليلات' });
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
  listAllCaptainsHandler,
  getCaptainDetailsHandler,
  getAdminStatsHandler,
  listRecentRidesHandler,
  getAnalyticsHandler,
};
