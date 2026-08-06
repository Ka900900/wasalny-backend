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

module.exports = router;
