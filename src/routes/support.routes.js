const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  createUserMessageHandler,
  getUserMessagesHandler,
} = require('../controllers/support.controller');

// أي مستخدم مسجّل يمكنه إرسال/قراءة محادثته
router.post('/messages', authenticateToken, createUserMessageHandler);
router.get('/messages', authenticateToken, getUserMessagesHandler);

module.exports = router;
