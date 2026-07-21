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
} = require('../controllers/notification.controller');

// ── إدارة التوكن والتفضيلات (للمستخدم العادي) ──
router.post('/token', authenticateToken, registerTokenHandler);
router.put('/preferences', authenticateToken, updatePreferencesHandler);
router.get('/preferences', authenticateToken, getPreferencesHandler);

// ── إرسال الإشعارات والحملات (للمسؤول فقط) ──
router.post('/send', authenticateToken, requireRole('ADMIN'), sendSingleHandler);
router.post('/campaign', authenticateToken, requireRole('ADMIN'), sendCampaignHandler);
router.get('/targets/count', authenticateToken, requireRole('ADMIN'), getTargetCountHandler);

module.exports = router;
