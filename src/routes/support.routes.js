const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createTicketSchema, addTicketMessageSchema } = require('../validators/support.validator');
const {
  // New ticket-based handlers
  getFAQsHandler,
  createTicketHandler,
  getUserTicketsHandler,
  getTicketDetailsHandler,
  addTicketMessageHandler,
  getTicketMessagesHandler,
  // Legacy handlers (backward compatibility)
  createUserMessageHandler,
  getUserMessagesHandler,
} = require('../controllers/support.controller');

// ── New Ticket System Routes ──────────────────────────

// GET /api/v1/support/faqs - الأسئلة الشائعة
router.get('/faqs', authenticateToken, getFAQsHandler);

// POST /api/v1/support/tickets - إنشاء تذكرة جديدة
router.post('/tickets', authenticateToken, validate(createTicketSchema), createTicketHandler);

// GET /api/v1/support/tickets - قائمة تذاكر المستخدم
router.get('/tickets', authenticateToken, getUserTicketsHandler);

// GET /api/v1/support/tickets/:ticketId - تفاصيل تذكرة
router.get('/tickets/:ticketId', authenticateToken, getTicketDetailsHandler);

// POST /api/v1/support/tickets/:ticketId/messages - إضافة رسالة لتذكرة
router.post('/tickets/:ticketId/messages', authenticateToken, validate(addTicketMessageSchema), addTicketMessageHandler);

// GET /api/v1/support/tickets/:ticketId/messages - جلب رسائل تذكرة
router.get('/tickets/:ticketId/messages', authenticateToken, getTicketMessagesHandler);

// ── Legacy Routes (Backward Compatibility) ────────────
// أي مستخدم مسجّل يمكنه إرسال/قراءة محادثته
router.post('/messages', authenticateToken, createUserMessageHandler);
router.get('/messages', authenticateToken, getUserMessagesHandler);

module.exports = router;
