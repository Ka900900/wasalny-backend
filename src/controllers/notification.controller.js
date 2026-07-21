const prisma = require('../config/prisma');
const { sendSingleNotification, sendBulkNotification, sendCampaignNotification } = require('../services/fcm.service');

/**
 * POST /api/v1/notifications/token
 * حفظ أو تحديث توكن FCM للمستخدم الحالي.
 */
async function registerTokenHandler(req, res) {
  try {
    const { fcmToken } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'المستخدم غير مصرح' });
    }

    if (typeof fcmToken !== 'string' || fcmToken.trim() === '') {
      return res.status(400).json({ error: 'fcmToken مطلوب' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: fcmToken.trim() },
    });

    return res.json({ success: true, message: 'تم حفظ التوكن بنجاح' });
  } catch (error) {
    console.error('❌ registerTokenHandler error:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء حفظ التوكن' });
  }
}

/**
 * POST /api/v1/notifications/preferences
 * تحديث تفضيلات الإشعارات (استقبال العروض).
 */
async function updatePreferencesHandler(req, res) {
  try {
    const { notificationPreferences } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'المستخدم غير مصرح' });
    }

    if (typeof notificationPreferences !== 'boolean') {
      return res.status(400).json({ error: 'notificationPreferences يجب أن يكون true أو false' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { notificationPreferences },
    });

    return res.json({
      success: true,
      message: notificationPreferences ? 'تم تفعيل الإشعارات' : 'تم إيقاف الإشعارات',
      notificationPreferences,
    });
  } catch (error) {
    console.error('❌ updatePreferencesHandler error:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء تحديث التفضيلات' });
  }
}

/**
 * GET /api/v1/notifications/preferences
 * جلب تفضيلات الإشعارات للمستخدم الحالي.
 */
async function getPreferencesHandler(req, res) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'المستخدم غير مصرح' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true, fcmToken: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    return res.json({
      notificationPreferences: user.notificationPreferences,
      hasFcmToken: !!user.fcmToken,
    });
  } catch (error) {
    console.error('❌ getPreferencesHandler error:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء جلب التفضيلات' });
  }
}

/**
 * POST /api/v1/notifications/send
 * أرسال إشعار فردي (للمسؤولين).
 */
async function sendSingleHandler(req, res) {
  try {
    const { userId, title, body, data } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({ error: 'userId, title, body مطلوبة' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) {
      return res.status(400).json({ error: 'المستخدم ليس لديه توكن FCM' });
    }

    const result = await sendSingleNotification(user.fcmToken, title, body, data);

    if (result.success) {
      return res.json({ success: true, message: 'تم إرسال الإشعار' });
    }

    return res.status(500).json({ error: result.error || 'فشل إرسال الإشعار' });
  } catch (error) {
    console.error('❌ sendSingleHandler error:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء إرسال الإشعار' });
  }
}

/**
 * POST /api/v1/notifications/campaign
 * أرسال حملة إشهارية (عرض/تحديث) إلى شريحة محددة (للمسؤولين).
 */
async function sendCampaignHandler(req, res) {
  try {
    const { title, body, targetRole = 'ALL', data, maxTokens } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'title و body مطلوبان' });
    }

    const validRoles = ['ALL', 'RIDER', 'DRIVER'];
    if (!validRoles.includes(targetRole)) {
      return res.status(400).json({ error: `targetRole غير صالح، القيم المقبولة: ${validRoles.join(', ')}` });
    }

    const result = await sendCampaignNotification({
      title,
      body,
      targetRole,
      data: data || {},
      maxTokens: maxTokens || undefined,
    });

    return res.json({
      success: true,
      message: `تم إرسال الحملة إلى ${result.sent} من ${result.total} مستخدم`,
      result,
    });
  } catch (error) {
    console.error('❌ sendCampaignHandler error:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء إرسال الحملة' });
  }
}

/**
 * GET /api/v1/notifications/targets/count
 * عرض عدد المستخدمين المستهدفين حسب الشريحة (للمسؤولين).
 */
async function getTargetCountHandler(req, res) {
  try {
    const { role } = req.query;

    const where = {
      fcmToken: { not: null },
      isActive: true,
      notificationPreferences: true,
    };

    if (role === 'RIDER' || role === 'DRIVER') {
      where.role = role;
    }

    const total = await prisma.user.count({ where });

    return res.json({
      targetRole: role || 'ALL',
      count: total,
    });
  } catch (error) {
    console.error('❌ getTargetCountHandler error:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء جلب العدد' });
  }
}

module.exports = {
  registerTokenHandler,
  updatePreferencesHandler,
  getPreferencesHandler,
  sendSingleHandler,
  sendCampaignHandler,
  getTargetCountHandler,
};
