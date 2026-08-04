const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { rejectWithdrawalSchema } = require('../validators/wallet.validator');
const {
  listWithdrawalsHandler,
  getAdminTopupsHandler,
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
} = require('../controllers/admin.controller');
const { rejectCaptainSchema } = require('../validators/admin.validator');
const {
  listConversationsHandler,
  getAdminUserMessagesHandler,
  createAdminMessageHandler,
  listAdminTicketsHandler,
  updateTicketStatusHandler,
  getAdminTicketMessagesHandler,
  createAdminTicketMessageHandler,
} = require('../controllers/support.controller');

// كل المسارات مخصصة للأدمن فقط

// مسارات لوحة التحكم (Dashboard)
router.get('/stats', authenticateToken, requireRole('ADMIN'), getAdminStatsHandler);
router.get('/rides', authenticateToken, requireRole('ADMIN'), listRecentRidesHandler);
router.get('/analytics', authenticateToken, requireRole('ADMIN'), getAnalyticsHandler);
router.get('/earnings', authenticateToken, requireRole('ADMIN'), getEarningsHandler);
router.get('/ratings', authenticateToken, requireRole('ADMIN'), listRatingsHandler);

router.get('/withdrawals', authenticateToken, requireRole('ADMIN'), listWithdrawalsHandler);
router.get('/wallet/topups', authenticateToken, requireRole('ADMIN'), getAdminTopupsHandler);
router.patch('/withdrawals/:id/approve', authenticateToken, requireRole('ADMIN'), approveWithdrawalHandler);
router.patch('/withdrawals/:id/reject', authenticateToken, requireRole('ADMIN'), validate(rejectWithdrawalSchema), rejectWithdrawalHandler);
router.patch('/withdrawals/:id/complete', authenticateToken, requireRole('ADMIN'), completeWithdrawalHandler);

// مسارات دعم العملاء (مخصصة للأدمن)
router.get('/support/conversations', authenticateToken, requireRole('ADMIN'), listConversationsHandler);
router.get('/support/messages/:userId', authenticateToken, requireRole('ADMIN'), getAdminUserMessagesHandler);
router.post('/support/messages/:userId', authenticateToken, requireRole('ADMIN'), createAdminMessageHandler);

// مسارات تذاكر الدعم (مخصصة للأدمن) — ticket-based
router.get('/support/tickets', authenticateToken, requireRole('ADMIN'), listAdminTicketsHandler);
router.get('/support/tickets/:id/messages', authenticateToken, requireRole('ADMIN'), getAdminTicketMessagesHandler);
router.post('/support/tickets/:id/messages', authenticateToken, requireRole('ADMIN'), createAdminTicketMessageHandler);
router.patch('/support/tickets/:id/status', authenticateToken, requireRole('ADMIN'), updateTicketStatusHandler);

// ═══════════════════════════════════════════════════════
//  مسارات توثيق الكباتن (Captain Verification)
// ═══════════════════════════════════════════════════════
router.get('/captains', authenticateToken, requireRole('ADMIN'), listAllCaptainsHandler);
router.get('/captains/pending', authenticateToken, requireRole('ADMIN'), listPendingCaptainsHandler);
router.get('/captains/:userId', authenticateToken, requireRole('ADMIN'), getCaptainDetailsHandler);
router.post('/captains/:userId/approve', authenticateToken, requireRole('ADMIN'), approveCaptainHandler);
router.post('/captains/:userId/reject', authenticateToken, requireRole('ADMIN'), validate(rejectCaptainSchema), rejectCaptainHandler);

// ═══════════════════════════════════════════════════════
//  مسارات الإشعارات (لوحة تحكم الأدمن)
// ═══════════════════════════════════════════════════════
router.get('/notifications', authenticateToken, requireRole('ADMIN'), listNotificationsHandler);
router.get('/notifications/unread-count', authenticateToken, requireRole('ADMIN'), getUnreadNotificationsCountHandler);
router.patch('/notifications/:id/read', authenticateToken, requireRole('ADMIN'), markNotificationReadHandler);
router.post('/notifications/read-all', authenticateToken, requireRole('ADMIN'), markAllNotificationsReadHandler);

// ═══════════════════════════════════════════════════════
//  مسارات الإعدادات (لوحة تحكم الأدمن)
// ═══════════════════════════════════════════════════════
router.get('/settings', authenticateToken, requireRole('ADMIN'), getSettingsHandler);
router.put('/settings', authenticateToken, requireRole('ADMIN'), updateSettingsHandler);

module.exports = router;
