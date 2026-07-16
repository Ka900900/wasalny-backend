const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { withdrawSchema, topUpSchema } = require('../validators/wallet.validator');
const { getWalletBalanceHandler, getTransactionsHandler, requestWithdrawalHandler, getWithdrawsHandler, topUpWalletHandler } = require('../controllers/wallet.controller');

router.get('/balance', authenticateToken, getWalletBalanceHandler);
router.get('/transactions', authenticateToken, getTransactionsHandler);
router.post('/withdraw', authenticateToken, requireRole('DRIVER'), validate(withdrawSchema), requestWithdrawalHandler);
router.get('/withdraws', authenticateToken, requireRole('DRIVER'), getWithdrawsHandler);
router.post('/top-up', authenticateToken, validate(topUpSchema), topUpWalletHandler);

module.exports = router;
