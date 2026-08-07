const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  registerTokenHandler,
  updatePreferencesHandler,
  getPreferencesHandler,
  sendSingleHandler,
  sendCampaignHandler,
  getTargetCountHandler,
  registerCaptainTokenHandler,
  getCaptainNotificationsHandler,
  markCaptainNotificationReadHandler,
  markAllCaptainNotificationsReadHandler,
} = require('../controllers/notification.controller');

// ── إدارة التوكن والتفضيلات (للمستخدم العادي) ──
router.post('/token', authenticateToken, registerTokenHandler);
router.put('/preferences', authenticateToken, updatePreferencesHandler);
router.get('/preferences', authenticateToken, getPreferencesHandler);

// ── إرسال الإشعارات والحملات (للمسؤول فقط) ──
router.post('/send', authenticateToken, requireRole('ADMIN'), sendSingleHandler);
router.post('/campaign', authenticateToken, requireRole('ADMIN'), sendCampaignHandler);
router.get('/targets/count', authenticateToken, requireRole('ADMIN'), getTargetCountHandler);

// ── إشعارات الكابتن (تُعرَّض تحت /api/v1/captain/...) ──
// POST  /api/v1/captain/fcm-token          — حفظ توكن FCM للكابتن
// GET   /api/v1/captain/notifications      — صندوق وارد الكابتن
// PATCH /api/v1/captain/notifications/:id/read — تعليم إشعار كمقروء
// POST  /api/v1/captain/notifications/read-all  — تعليم الكل كمقروء
router.post('/fcm-token', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), registerCaptainTokenHandler);
router.get('/notifications', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), getCaptainNotificationsHandler);
router.patch('/notifications/:id/read', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), markCaptainNotificationReadHandler);
router.post('/notifications/read-all', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), markAllCaptainNotificationsReadHandler);

// ── إشعارات الراكب (تُعرَّض تحت /api/v1/notifications/rider) ──
// GET   /api/v1/notifications/rider          — صندوق وارد الراكب
// PATCH /api/v1/notifications/rider/:id/read — تعليم إشعار كمقروء
// POST  /api/v1/notifications/rider/read-all — تعليم الكل كمقروء
// نفس handlers لأنها عامة (تعتمد على req.user.userId فقط).
router.get('/rider', authenticateToken, requireRole('RIDER'), getCaptainNotificationsHandler);
router.patch('/rider/:id/read', authenticateToken, requireRole('RIDER'), markCaptainNotificationReadHandler);
router.post('/rider/read-all', authenticateToken, requireRole('RIDER'), markAllCaptainNotificationsReadHandler);

module.exports = router;
