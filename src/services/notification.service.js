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

module.exports = {
  createAdminNotification,
  createCaptainPendingNotification,
};
