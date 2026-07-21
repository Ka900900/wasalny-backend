const { getMessaging } = require('../config/firebase');

/**
 * Firebase Cloud Messaging (FCM) service.
 *
 * Sends push notifications to captains when a new ride request is created.
 * The captain's FCM token is stored on the User row (`fcmToken`).
 *
 * All FCM calls are best-effort / non-fatal: a failure to deliver a push
 * must never break the ride-creation flow (the real-time Firestore mirror
 * and Socket.IO are the primary delivery channels).
 */

/**
 * Send a "new ride" push notification to a single captain device.
 *
 * @param {string} fcmToken  - The captain's FCM registration token.
 * @param {object} ride      - The created ride request (must include id).
 * @param {object} [opts]    - Optional display overrides.
 * @returns {Promise<boolean>} true if the message was accepted by FCM.
 */
async function sendNewRideNotification(fcmToken, ride, opts = {}) {
  if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim() === '') {
    // No token registered yet — nothing to send (not an error).
    return false;
  }

  const title = opts.title || 'رحلة جديدة!';
  const body = opts.body || 'لديك طلب توصيل جديد، اضغط للتفاصيل';

  const message = {
    token: fcmToken,
    notification: {
      title,
      body,
    },
    // Data payload — opened by the app to navigate to the specific ride screen.
    data: {
      type: 'new_ride',
      rideId: ride?.id || '',
      clickAction: 'FLUTTER_NOTIFICATION_CLICK',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'ride_requests',
        priority: 'max',
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          contentAvailable: true,
        },
      },
    },
  };

  try {
    const messaging = getMessaging();
    const response = await messaging.send(message);
    console.log(`📲 FCM new-ride notification sent (ride ${ride?.id}): ${response}`);
    return true;
  } catch (error) {
    // Non-fatal: log the real error so we can trace delivery problems in the field.
    console.error('❌ FCM sendNewRideNotification failed:', error?.message || error);
    // If the token is no longer valid, the caller may want to clear it.
    if (
      error?.code === 'messaging/registration-token-not-registered' ||
      error?.code === 'messaging/invalid-registration-token'
    ) {
      return 'INVALID_TOKEN';
    }
    return false;
  }
}

/**
 * Notify all available captains about a new ride.
 *
 * @param {string[]} fcmTokens - List of captain FCM tokens to notify.
 * @param {object} ride        - The created ride request.
 * @returns {Promise<{sent:number, failed:number, invalidTokens:string[]}>}
 */
async function notifyCaptainsNewRide(fcmTokens, ride) {
  const result = { sent: 0, failed: 0, invalidTokens: [] };
  for (const token of fcmTokens) {
    const r = await sendNewRideNotification(token, ride);
    if (r === true) result.sent += 1;
    else if (r === 'INVALID_TOKEN') result.invalidTokens.push(token);
    else result.failed += 1;
  }
  return result;
}

/**
 * أرسال إشعار فردي إلى جهاز واحد.
 *
 * @param {string} fcmToken - توكن FCM للجهاز المستهدف.
 * @param {string} title    - عنوان الإشعار.
 * @param {string} body     - نص الإشعار.
 * @param {object} [data]   - بيانات إضافية (مثل { type, rideId, ... }).
 * @returns {Promise<{success:boolean, error?:string}>}
 */
async function sendSingleNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim() === '') {
    return { success: false, error: 'FCM token is empty' };
  }

  const message = {
    token: fcmToken,
    notification: { title, body },
    data: { ...data, clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
    android: {
      priority: 'high',
      notification: { channelId: 'default', priority: 'max', defaultSound: true },
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
    },
  };

  try {
    const messaging = getMessaging();
    const response = await messaging.send(message);
    console.log(`📲 FCM single notification sent: ${response}`);
    return { success: true };
  } catch (error) {
    console.error('❌ FCM sendSingleNotification failed:', error?.message || error);
    if (
      error?.code === 'messaging/registration-token-not-registered' ||
      error?.code === 'messaging/invalid-registration-token'
    ) {
      return { success: false, error: 'INVALID_TOKEN' };
    }
    return { success: false, error: error?.message || 'Unknown error' };
  }
}

/**
 * أرسال إشعارات جماعية إلى قائمة من التوكنات.
 *
 * @param {string[]} fcmTokens - قائمة توكنات FCM.
 * @param {string} title       - عنوان الإشعار.
 * @param {string} body        - نص الإشعار.
 * @param {object} [data]      - بيانات إضافية.
 * @returns {Promise<{sent:number, failed:number, invalidTokens:string[]}>}
 */
async function sendBulkNotification(fcmTokens, title, body, data = {}) {
  const result = { sent: 0, failed: 0, invalidTokens: [] };
  for (const token of fcmTokens) {
    const r = await sendSingleNotification(token, title, body, data);
    if (r.success) result.sent += 1;
    else if (r.error === 'INVALID_TOKEN') result.invalidTokens.push(token);
    else result.failed += 1;
  }
  return result;
}

/**
 * أرسال حملة إشهارية (عرض/تحديث) إلى شريحة محددة من المستخدمين أو الكباتن.
 * تدعم التصفية حسب الـ role (RIDER/DRIVER) ومنطقه (اختياري).
 *
 * @param {object} params
 * @param {string} params.title           - عنوان الإشعار.
 * @param {string} params.body            - نص الإشعار.
 * @param {'RIDER'|'DRIVER'|'ALL'} [params.targetRole='ALL'] - الشريحة المستهدفة.
 * @param {object} [params.data]          - بيانات إضافية للحملة.
 * @param {number} [params.maxTokens]     - حد أقصى لعدد التوكنات (للاختبار).
 * @returns {Promise<{total:number, sent:number, failed:number, invalidTokens:string[]}>}
 */
async function sendCampaignNotification({ title, body, targetRole = 'ALL', data = {}, maxTokens }) {
  const prisma = require('../config/prisma');

  // بناء شرط التصفية
  const where = {
    fcmToken: { not: null },
    isActive: true,
    notificationPreferences: true,
  };

  if (targetRole === 'RIDER' || targetRole === 'DRIVER') {
    where.role = targetRole;
  }

  // جلب المستخدمين المستهدفين
  const users = await prisma.user.findMany({
    where,
    select: { id: true, fcmToken: true },
    take: maxTokens || undefined,
  });

  const fcmTokens = users.map((u) => u.fcmToken).filter(Boolean);
  if (fcmTokens.length === 0) {
    console.log('📭 No target users with valid FCM tokens found');
    return { total: 0, sent: 0, failed: 0, invalidTokens: [] };
  }

  console.log(`📢 Campaign "${title}" — target=${targetRole}, tokens=${fcmTokens.length}`);
  const result = await sendBulkNotification(fcmTokens, title, body, { ...data, type: 'campaign' });

  return {
    total: fcmTokens.length,
    ...result,
  };
}

module.exports = {
  sendNewRideNotification,
  notifyCaptainsNewRide,
  sendSingleNotification,
  sendBulkNotification,
  sendCampaignNotification,
};
