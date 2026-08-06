/**
 * Notification service — إشعارات لوحة تحكم الأدمن (in-app).
 *
 * إشعارات الأدمن تُنشأ بـ userId = null (إشعار عام يظهر في لوحة التحكم).
 * الدالة تُغلَّف بـ try/catch حتى لا يُفشل أي خطأ في إنشاء الإشعار العملية الأصلية
 * (إنشاء تذكرة دعم، طلب سحب، تقييم، تسجيل كابتن ... إلخ).
 */
const prisma = require('../config/prisma');

/**
 * إنشاء إشعار عام للأدمن.
 * @param {{ type: string, title: string, body: string, data?: object, link?: string }} input
 * @returns {Promise<object|null>} كائن الإشعار أو null عند الفشل
 */
async function createAdminNotification({ type, title, body, data, link }) {
  try {
    return await prisma.notification.create({
      data: {
        userId: null, // إشعار عام للأدمن
        type,
        title,
        body,
        data: data || undefined,
        link: link || null,
      },
    });
  } catch (error) {
    console.error('⚠️ createAdminNotification error:', error?.message);
    return null;
  }
}

/**
 * إنشاء إشعار "كابتن جديد بانتظار المراجعة" مع منع التكرار.
 * نتأكد ألا يوجد إشعار غير مقروء بنفس النوع لنفس الكابتن قبل الإنشاء.
 * @param {string} userId معرف الكابتن الجديد
 * @param {{ type: string, title: string, body: string, link?: string }} input
 */
async function createCaptainPendingNotification(userId, { type, title, body, link }) {
  try {
    if (!userId) return null;
    const existing = await prisma.notification.findFirst({
      where: {
        type,
        isRead: false,
        data: { path: ['userId'], equals: userId },
      },
      select: { id: true },
    });
    if (existing) return existing; // يوجد إشعار سابق غير مقروء → لا نكرّر
    return await prisma.notification.create({
      data: {
        userId: null,
        type,
        title,
        body,
        data: { userId },
        link: link || null,
      },
    });
  } catch (error) {
    console.error('⚠️ createCaptainPendingNotification error:', error?.message);
    return null;
  }
}

/**
 * جلب قائمة إشعارات الكابتن (صندوق الوارد داخل التطبيق).
 * تُخزَّن إشعارات الكابتن بـ userId = معرف الكابتن لكل إشعار (حتى يكون
 * لكل كابتن حالة قراءة مستقلة).
 *
 * @param {string} userId معرف الكابتن
 * @param {{ page?: number, limit?: number, unreadOnly?: boolean }} [opts]
 * @returns {Promise<{ notifications: object[], pagination: object, unreadCount: number }>}
 */
async function getCaptainNotifications(userId, { page = 1, limit = 50, unreadOnly = false } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const where = { userId };
  if (unreadOnly) where.isRead = false;

  const [total, unreadCount, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum,
    }),
  ]);

  return {
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      link: n.link,
      audience: n.audience,
      createdBy: n.createdBy,
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
  };
}

/**
 * تعليم إشعار واحد للكابتن كمقروء (للكابتن نفسه فقط).
 * @param {string} userId معرف الكابتن
 * @param {string} notificationId معرف الإشعار
 * @returns {Promise<boolean>} هل تم التحديث؟
 */
async function markCaptainNotificationRead(userId, notificationId) {
  const updated = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
  return updated.count > 0;
}

/**
 * تعليم جميع إشعارات الكابتن كمقروءة.
 * @param {string} userId معرف الكابتن
 * @returns {Promise<number>} عدد الإشعارات المحدّثة
 */
async function markAllCaptainNotificationsRead(userId) {
  const updated = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return updated.count;
}

/**
 * بث إعلان من الأدمن إلى الكباتن.
 *
 * الخطوات:
 *  1) تحديد المستهدفين (كل الكباتن أو كابتن محدد) ممن لديهم fcmToken وفعّالون.
 *  2) إنشاء سجل إشعار للأدمن (userId = null) ليكون في "سجل ما تم إرساله".
 *  3) إنشاء إشعار لكل كابتن مستهدف (userId = كل كابتن) بشرط createMany
 *     حتى يستطيع كل كابتن تعليم إشعاره كمقروء بشكل مستقل.
 *  4) إرسال FCM لكل التوكنات — أي فشل جزئي لا يُفشل العملية (best-effort).
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.body
 * @param {string} [params.type='ADMIN_ANNOUNCEMENT']
 * @param {'ALL_CAPTAINS'|'CAPTAIN'} [params.audience='ALL_CAPTAINS']
 * @param {string} [params.targetUserId] — معرف كابتن محدد عند audience = CAPTAIN
 * @param {object} [params.data]
 * @param {string} [params.createdBy] — معرف الأدمن المُرسِل
 * @returns {Promise<{ success: boolean, total: number, sent: number, failed: number, invalidTokens: string[], broadcastId?: string }>}
 */
async function broadcastToCaptains({ title, body, type = 'ADMIN_ANNOUNCEMENT', audience = 'ALL_CAPTAINS', targetUserId, data = {}, createdBy = null }) {
  const { sendBulkNotification } = require('./fcm.service');

  // 1) تحديد المستهدفين
  let targets = [];
  if (audience === 'CAPTAIN' && targetUserId) {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, fcmToken: true, role: true },
    });
    if (user && (user.role === 'DRIVER' || user.role === 'CAPTAIN')) {
      targets = [user];
    }
  } else {
    // كل الكباتن النشطين ممن لديهم توكن FCM
    targets = await prisma.user.findMany({
      where: {
        role: { in: ['DRIVER', 'CAPTAIN'] },
        isActive: true,
        fcmToken: { not: null },
        notificationPreferences: true,
      },
      select: { id: true, fcmToken: true },
    });
  }

  const result = { success: true, total: targets.length, sent: 0, failed: 0, invalidTokens: [], broadcastId: null };

  // 2) سجل الإشعار للأدمن (يظهر في /admin/notifications)
  const adminLog = await prisma.notification.create({
    data: {
      userId: null,
      type,
      title,
      body,
      audience,
      createdBy: createdBy || undefined,
      data: {
        ...data,
        targetAudience: audience,
        targetUserId: targetUserId || null,
        targetCount: targets.length,
      },
    },
  });
  result.broadcastId = adminLog.id;

  // 3) إشعار لكل كابتن مستهدف (createMany دفعة واحدة)
  if (targets.length > 0) {
    await prisma.notification.createMany({
      data: targets.map((t) => ({
        userId: t.id,
        type,
        title,
        body,
        audience,
        createdBy: createdBy || undefined,
        data: data || undefined,
      })),
    });
  }

  // 4) إرسال FCM (best-effort — لا يُفشل العملية عند فشل جزئي)
  const fcmTokens = targets.map((t) => t.fcmToken).filter(Boolean);
  if (fcmTokens.length > 0) {
    const fcmResult = await sendBulkNotification(fcmTokens, title, body, {
      ...data,
      type: type.toLowerCase(), // مثل admin_announcement
      broadcastId: adminLog.id,
    });
    result.sent = fcmResult.sent;
    result.failed = fcmResult.failed;
    result.invalidTokens = fcmResult.invalidTokens || [];
  }

  return result;
}

module.exports = {
  createAdminNotification,
  createCaptainPendingNotification,
  getCaptainNotifications,
  markCaptainNotificationRead,
  markAllCaptainNotificationsRead,
  broadcastToCaptains,
};
