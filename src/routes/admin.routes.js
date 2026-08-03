const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { rejectWithdrawalSchema } = require('../validators/wallet.validator');
const {
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
} = require('../controllers/admin.controller');
const { rejectCaptainSchema } = require('../validators/admin.validator');
const {
  listConversationsHandler,
  getAdminUserMessagesHandler,
  createAdminMessageHandler,
} = require('../controllers/support.controller');

// كل المسارات مخصصة للأدمن فقط

// مسارات لوحة التحكم (Dashboard)
router.get('/stats', authenticateToken, requireRole('ADMIN'), getAdminStatsHandler);
router.get('/rides', authenticateToken, requireRole('ADMIN'), listRecentRidesHandler);
router.get('/analytics', authenticateToken, requireRole('ADMIN'), getAnalyticsHandler);
router.get('/earnings', authenticateToken, requireRole('ADMIN'), getEarningsHandler);

router.get('/withdrawals', authenticateToken, requireRole('ADMIN'), listWithdrawalsHandler);
router.patch('/withdrawals/:id/approve', authenticateToken, requireRole('ADMIN'), approveWithdrawalHandler);
router.patch('/withdrawals/:id/reject', authenticateToken, requireRole('ADMIN'), validate(rejectWithdrawalSchema), rejectWithdrawalHandler);
router.patch('/withdrawals/:id/complete', authenticateToken, requireRole('ADMIN'), completeWithdrawalHandler);

// مسارات دعم العملاء (مخصصة للأدمن)
router.get('/support/conversations', authenticateToken, requireRole('ADMIN'), listConversationsHandler);
router.get('/support/messages/:userId', authenticateToken, requireRole('ADMIN'), getAdminUserMessagesHandler);
router.post('/support/messages/:userId', authenticateToken, requireRole('ADMIN'), createAdminMessageHandler);

// ═══════════════════════════════════════════════════════
//  مسارات توثيق الكباتن (Captain Verification)
// ═══════════════════════════════════════════════════════
router.get('/captains', authenticateToken, requireRole('ADMIN'), listAllCaptainsHandler);
router.get('/captains/pending', authenticateToken, requireRole('ADMIN'), listPendingCaptainsHandler);
router.get('/captains/:userId', authenticateToken, requireRole('ADMIN'), getCaptainDetailsHandler);
router.post('/captains/:userId/approve', authenticateToken, requireRole('ADMIN'), approveCaptainHandler);
router.post('/captains/:userId/reject', authenticateToken, requireRole('ADMIN'), validate(rejectCaptainSchema), rejectCaptainHandler);

module.exports = router;
