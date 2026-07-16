const prisma = require('../config/prisma');

// ── User: إرسال رسالة دعم ───────────────────────────
async function createUserMessageHandler(req, res) {
  try {
    const userId = req.user.userId;
    const { text } = req.body;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    }
    const message = await prisma.supportMessage.create({
      data: { userId, sender: 'USER', text: text.trim() },
    });
    res.status(201).json({
      id: message.id,
      sender: message.sender,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء إرسال الرسالة' });
  }
}

// ── User: جلب محادثته بالكامل ───────────────────────
async function getUserMessagesHandler(req, res) {
  try {
    const userId = req.user.userId;
    const messages = await prisma.supportMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء جلب المحادثة' });
  }
}

// ── Admin: قائمة المحادثات (مستخدم واحد لكل مدخل) ────
async function listConversationsHandler(req, res) {
  try {
    const participants = await prisma.supportMessage.findMany({
      distinct: ['userId'],
      select: { userId: true },
    });
    const conversations = await Promise.all(
      participants.map(async ({ userId }) => {
        const last = await prisma.supportMessage.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { firstName: true, lastName: true } } },
        });
        return {
          userId,
          userName: `${last.user?.firstName || ''} ${last.user?.lastName || ''}`.trim() || 'مستخدم',
          lastMessage: last.text,
          lastSender: last.sender,
          lastAt: last.createdAt.toISOString(),
        };
      })
    );
    conversations.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)); // الأحدث أولاً
    res.json(conversations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء جلب المحادثات' });
  }
}

// ── Admin: محادثة مستخدم معيّن ──────────────────────
async function getAdminUserMessagesHandler(req, res) {
  try {
    const { userId } = req.params;
    const messages = await prisma.supportMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء جلب محادثة المستخدم' });
  }
}

// ── Admin: رد بدور ADMIN على مستخدم ─────────────────
async function createAdminMessageHandler(req, res) {
  try {
    const { userId } = req.params;
    const { text } = req.body;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const message = await prisma.supportMessage.create({
      data: { userId, sender: 'ADMIN', text: text.trim() },
    });
    res.status(201).json({
      id: message.id,
      sender: message.sender,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء إرسال الرد' });
  }
}

module.exports = {
  createUserMessageHandler,
  getUserMessagesHandler,
  listConversationsHandler,
  getAdminUserMessagesHandler,
  createAdminMessageHandler,
};
