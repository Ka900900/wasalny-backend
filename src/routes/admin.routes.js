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
} = require('../controllers/admin.controller');
const {
  listConversationsHandler,
  getAdminUserMessagesHandler,
  createAdminMessageHandler,
} = require('../controllers/support.controller');

// كل المسارات مخصصة للأدمن فقط
router.get('/withdrawals', authenticateToken, requireRole('ADMIN'), listWithdrawalsHandler);
router.patch('/withdrawals/:id/approve', authenticateToken, requireRole('ADMIN'), approveWithdrawalHandler);
router.patch('/withdrawals/:id/reject', authenticateToken, requireRole('ADMIN'), validate(rejectWithdrawalSchema), rejectWithdrawalHandler);
router.patch('/withdrawals/:id/complete', authenticateToken, requireRole('ADMIN'), completeWithdrawalHandler);

// مسارات دعم العملاء (مخصصة للأدمن)
router.get('/support/conversations', authenticateToken, requireRole('ADMIN'), listConversationsHandler);
router.get('/support/messages/:userId', authenticateToken, requireRole('ADMIN'), getAdminUserMessagesHandler);
router.post('/support/messages/:userId', authenticateToken, requireRole('ADMIN'), createAdminMessageHandler);

module.exports = router;
