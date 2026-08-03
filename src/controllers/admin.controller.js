const prisma = require('../config/prisma');
const {
  listWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal,
} = require('../services/wallet.service');
const { sendSingleNotification } = require('../services/fcm.service');
const { resetConfigCache } = require('../services/ride.service');

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

// ── GET /api/v1/admin/earnings?period=monthly|halfYearly|yearly ──
// Response shape matches the admin dashboard (wasalny-admin) contract:
//   { period, summary: { revenue, commission, captainEarnings, completedRides },
//     points: [{ label, revenue, commission, captainEarnings, rides }] }
// Also includes companyCommission / completedRides aliases per the requested spec.
// period semantics:
//   monthly    = last 30 days   → aggregated DAILY
//   halfYearly = last 6 months  → aggregated MONTHLY
//   yearly     = last 12 months → aggregated MONTHLY
async function getEarningsHandler(req, res) {
  try {
    const rawPeriod = (req.query.period || 'halfYearly').trim().toLowerCase();
    // Accept the dashboard spelling (halfYearly) + old spelling (semiannual), case-insensitive
    let period;
    if (rawPeriod === 'monthly') period = 'monthly';
    else if (rawPeriod === 'halfyearly' || rawPeriod === 'semiannual') period = 'halfYearly';
    else if (rawPeriod === 'yearly') period = 'yearly';
    else return res.status(400).json({ error: 'period must be monthly, halfYearly or yearly' });

    const ARABIC_MONTHS = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
    ];

    const now = new Date();
    const windows = [];

    // Build the time windows (oldest-first so the chart reads left → right).
    if (period === 'monthly') {
      // Last 30 days, one window per full day [00:00, next 00:00)
      for (let i = 29; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        windows.push({
          start,
          end,
          label: `${start.getDate()} ${ARABIC_MONTHS[start.getMonth()]}`,
        });
      }
    } else if (period === 'halfYearly' || period === 'yearly') {
      // Last 6 (halfYearly) or 12 (yearly) months, one window per calendar month.
      const count = period === 'halfYearly' ? 6 : 12;
      const base = new Date(now.getFullYear(), now.getMonth(), 1);
      for (let i = count - 1; i >= 0; i--) {
        const start = new Date(base.getFullYear(), base.getMonth() - i, 1);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        windows.push({ start, end, label: ARABIC_MONTHS[start.getMonth()] });
      }
    }

    // Aggregate COMPLETED rides per window (paidAt when present, else createdAt).
    const points = [];
    for (const w of windows) {
      const agg = await prisma.rideRequest.aggregate({
        _sum: { price: true, commission: true, driverEarning: true },
        _count: { _all: true },
        where: {
          status: 'COMPLETED',
          OR: [
            { paidAt: { gte: w.start, lt: w.end } },
            { paidAt: null, createdAt: { gte: w.start, lt: w.end } },
          ],
        },
      });

      const revenue = Math.round(Number(agg._sum.price || 0) * 100) / 100;
      const commission = Math.round(Number(agg._sum.commission || 0) * 100) / 100;
      const captainEarnings = Math.round(Number(agg._sum.driverEarning || 0) * 100) / 100;
      const rides = Number(agg._count._all || 0);

      points.push({
        label: w.label,
        revenue,
        commission,
        companyCommission: commission, // alias per admin spec
        captainEarnings,
        rides,
        completedRides: rides, // alias per admin spec
      });
    }

    // Summary = totals over all windows (dashboard KPI cards).
    const summary = {
      revenue: 0,
      commission: 0,
      companyCommission: 0,
      captainEarnings: 0,
      completedRides: 0,
    };
    for (const p of points) {
      summary.revenue += p.revenue;
      summary.commission += p.commission;
      summary.companyCommission += p.companyCommission;
      summary.captainEarnings += p.captainEarnings;
      summary.completedRides += p.completedRides;
    }
    summary.revenue = Math.round(summary.revenue * 100) / 100;
    summary.commission = Math.round(summary.commission * 100) / 100;
    summary.companyCommission = Math.round(summary.companyCommission * 100) / 100;
    summary.captainEarnings = Math.round(summary.captainEarnings * 100) / 100;

    res.json({ period, summary, points });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب بيانات الأرباح' });
  }
}

// ── GET /api/v1/admin/ratings?page=&limit=&minRating=&maxRating=&captainId=&from=&to= ──
// قائمة تقييمات مع فلترة + pagination + summary (متوسط/توزيع النجوم).
async function listRatingsHandler(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const minRating = parseInt(req.query.minRating, 10);
    const maxRating = parseInt(req.query.maxRating, 10);
    const { captainId } = req.query;

    const where = {};

    if (!Number.isNaN(minRating) && minRating >= 1 && minRating <= 5) {
      where.rating = { gte: minRating };
    }
    if (!Number.isNaN(maxRating) && maxRating >= 1 && maxRating <= 5) {
      where.rating = { ...(where.rating || {}), lte: maxRating };
    }
    if (captainId) where.toUserId = captainId;

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (from && !Number.isNaN(from.getTime())) {
      where.createdAt = { ...(where.createdAt || {}), gte: from };
    }
    if (to && !Number.isNaN(to.getTime())) {
      where.createdAt = { ...(where.createdAt || {}), lt: to };
    }

    // إحصائيات (تحترم الفلاتر وتتجاهل pagination)
    const [total, aggregate, grouped] = await Promise.all([
      prisma.rating.count({ where }),
      prisma.rating.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
      prisma.rating.groupBy({ by: ['rating'], where, _count: { _all: true } }),
    ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const g of grouped) {
      if (distribution[g.rating] !== undefined) distribution[g.rating] = g._count._all;
    }

    const ratings = await prisma.rating.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true, role: true, phoneNumber: true } },
        toUser: { select: { id: true, firstName: true, lastName: true, role: true, phoneNumber: true } },
      },
    });

    const fmtUser = (u) =>
      u
        ? {
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—',
            role: u.role,
            phoneNumber: u.phoneNumber,
          }
        : null;

    res.json({
      ratings: ratings.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        rideId: r.rideId,
        fromUser: fmtUser(r.fromUser),
        toUser: fmtUser(r.toUser),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        averageRating: aggregate._avg.rating ? Number(Number(aggregate._avg.rating).toFixed(2)) : 0,
        totalRatings: aggregate._count._all,
        fiveStarCount: distribution[5],
        lowRatingCount: distribution[1] + distribution[2],
        distribution,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب التقييمات' });
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
  getEarningsHandler,
  listRatingsHandler,
  listNotificationsHandler,
  getUnreadNotificationsCountHandler,
  markNotificationReadHandler,
  markAllNotificationsReadHandler,
  getSettingsHandler,
  updateSettingsHandler,
};

// ═══════════════════════════════════════════════════════
//  NOTIFICATIONS HANDLERS (إشعارات لوحة تحكم الأدمن)
// ═══════════════════════════════════════════════════════

// ── GET /api/v1/admin/notifications?page=&limit=&unreadOnly= ──
async function listNotificationsHandler(req, res) {
  try {
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = { userId: null }; // إشعارات الأدمن فقط
    if (unreadOnly === 'true' || unreadOnly === '1') {
      where.isRead = false;
    }

    const [total, unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    res.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        link: n.link,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
      unreadCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الإشعارات' });
  }
}

// ── GET /api/v1/admin/notifications/unread-count ──
async function getUnreadNotificationsCountHandler(req, res) {
  try {
    const count = await prisma.notification.count({
      where: { userId: null, isRead: false },
    });
    res.json({ count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب عدد الإشعارات غير المقروءة' });
  }
}

// ── PATCH /api/v1/admin/notifications/:id/read ──
async function markNotificationReadHandler(req, res) {
  try {
    const { id } = req.params;
    const updated = await prisma.notification.updateMany({
      where: { id, userId: null },
      data: { isRead: true },
    });
    if (updated.count === 0) {
      return res.status(404).json({ error: 'الإشعار غير موجود' });
    }
    res.json({ message: 'تم تعليم الإشعار كمقروء' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في تحديث الإشعار' });
  }
}

// ── POST /api/v1/admin/notifications/read-all ──
async function markAllNotificationsReadHandler(req, res) {
  try {
    await prisma.notification.updateMany({
      where: { userId: null, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'تم تعليم جميع الإشعارات كمقروءة' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في تحديث الإشعارات' });
  }
}

// ═══════════════════════════════════════════════════════
//  SETTINGS HANDLERS (إعدادات لوحة التحكم — نسبة العمولة)
// ═══════════════════════════════════════════════════════

// ── GET /api/v1/admin/settings ──
async function getSettingsHandler(req, res) {
  try {
    const row = await prisma.config.findUnique({
      where: { key: 'COMMISSION_RATE' },
    });
    // القيمة المخزنة ككسر عشري (0.15 = 15%) → نحوّلها لنسبة مئوية للواجهة
    const stored = row ? parseFloat(row.value) : 0.1;
    res.json({ commissionRate: Math.round(stored * 10000) / 100 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الإعدادات' });
  }
}

// ── PUT /api/v1/admin/settings ──
async function updateSettingsHandler(req, res) {
  try {
    const { commissionRate } = req.body;
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ error: 'نسبة العمولة يجب أن تكون رقماً بين 0 و 100' });
    }

    await prisma.config.upsert({
      where: { key: 'COMMISSION_RATE' },
      update: { value: String(rate / 100) },
      create: {
        key: 'COMMISSION_RATE',
        value: String(rate / 100),
        valueType: 'NUMBER',
        description: 'نسبة عمولة الشركة من كل رحلة (كسر عشري: 0.15 = 15%)',
      },
    });

    // إبطال كاش إعدادات الرحلات حتى تُطبَّق النسبة الجديدة فوراً على الرحلات التالية
    resetConfigCache();

    res.json({ message: 'تم حفظ الإعدادات بنجاح', commissionRate: rate });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'خطأ في حفظ الإعدادات' });
  }
}
