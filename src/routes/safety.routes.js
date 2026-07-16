const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { sosAlertSchema } = require('../validators/safety.validator');
const { sendSOSAlertHandler } = require('../controllers/safety.controller');

// أي مستخدم مسجّل يمكنه إرسال تنبيه طوارئ (SOS)
router.post(
  '/sos-alert',
  authenticateToken,
  validate(sosAlertSchema),
  sendSOSAlertHandler
);

module.exports = router;
