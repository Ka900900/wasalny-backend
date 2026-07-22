const prisma = require('../config/prisma');

// ═══════════════════════════════════════════════════════
//  NEW TICKET-BASED HANDLERS
// ═══════════════════════════════════════════════════════

// ── GET /api/v1/support/faqs ──────────────────────────
async function getFAQsHandler(req, res) {
  try {
    const faqs = await prisma.fAQ.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        question: true,
        answer: true,
        category: true,
        createdAt: true,
      },
    });
    res.json({ success: true, faqs });
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({ success: false, error: 'خطأ في جلب الأسئلة الشائعة' });
  }
}

// ── POST /api/v1/support/tickets ──────────────────────
async function createTicketHandler(req, res) {
  try {
    const userId = req.user.userId;
    const { subject, rideId, message } = req.body;

    // التحقق من وجود الرحلة إذا تم تمرير rideId
    if (rideId) {
      const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
      if (!ride) {
        return res.status(400).json({ success: false, error: 'الرحلة غير موجودة' });
      }
    }

    // إنشاء التذكرة والرسالة الأولى في معاملة واحدة
    const ticket = await prisma.$transaction(async (tx) => {
      const newTicket = await tx.supportTicket.create({
        data: {
          userId,
          rideId: rideId || null,
          subject,
          status: 'OPEN',
        },
      });

      await tx.supportMessage.create({
        data: {
          ticketId: newTicket.id,
          userId,
          senderType: 'USER',
          text: message.trim(),
        },
      });

      return newTicket;
    });

    // إرجاع التذكرة مع رسالة التأكيد
    const createdTicket = await prisma.supportTicket.findUnique({
      where: { id: ticket.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderType: true,
            text: true,
            createdAt: true,
          },
        },
        ride: {
          select: { id: true, pickupPoint: true, dropoffPoint: true },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'تم إنشاء التذكرة بنجاح',
      ticket: createdTicket,
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ success: false, error: 'خطأ في إنشاء التذكرة' });
  }
}

// ── GET /api/v1/support/tickets ───────────────────────
async function getUserTicketsHandler(req, res) {
  try {
    const userId = req.user.userId;

    const tickets = await prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // آخر رسالة فقط للمعاينة
          select: {
            id: true,
            senderType: true,
            text: true,
            createdAt: true,
          },
        },
        ride: {
          select: { id: true, pickupPoint: true, dropoffPoint: true },
        },
      },
    });

    res.json({ success: true, tickets });
  } catch (error) {
    console.error('Error fetching user tickets:', error);
    res.status(500).json({ success: false, error: 'خطأ في جلب التذاكر' });
  }
}

// ── GET /api/v1/support/tickets/:ticketId ─────────────
async function getTicketDetailsHandler(req, res) {
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderType: true,
            text: true,
            createdAt: true,
          },
        },
        ride: {
          select: { id: true, pickupPoint: true, dropoffPoint: true, status: true },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'التذكرة غير موجودة' });
    }

    if (ticket.userId !== userId) {
      return res.status(403).json({ success: false, error: 'غير مصرح لك بمشاهدة هذه التذكرة' });
    }

    res.json({ success: true, ticket });
  } catch (error) {
    console.error('Error fetching ticket details:', error);
    res.status(500).json({ success: false, error: 'خطأ في جلب تفاصيل التذكرة' });
  }
}

// ── POST /api/v1/support/tickets/:ticketId/messages ───
async function addTicketMessageHandler(req, res) {
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;
    const { text } = req.body;

    // التحقق من وجود التذكرة وملكيتها
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, status: true },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'التذكرة غير موجودة' });
    }

    if (ticket.userId !== userId) {
      return res.status(403).json({ success: false, error: 'غير مصرح لك بإضافة رسالة لهذه التذكرة' });
    }

    if (ticket.status !== 'OPEN' && ticket.status !== 'IN_PROGRESS') {
      return res.status(400).json({ success: false, error: 'لا يمكن إضافة رسالة لتذكرة مغلقة' });
    }

    // إضافة الرسالة وتحديث وقت التذكرة
    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.supportMessage.create({
        data: {
          ticketId,
          userId,
          senderType: 'USER',
          text: text.trim(),
        },
      });

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { updatedAt: new Date() },
      });

      return newMessage;
    });

    // بث الرسالة عبر Socket.IO إلى غرفة الدعم
    try {
      const io = req.app.locals.io;
      if (io) {
        const room = `support_${ticketId}`;
        const payload = {
          id: message.id,
          ticketId: message.ticketId,
          senderType: message.senderType,
          text: message.text,
          createdAt: message.createdAt.toISOString(),
        };
        io.to(room).emit('receive_support_message', payload);
        console.log(`🎫 REST: Support message broadcast to room ${room}`);
      }
    } catch (socketErr) {
      // فشل البث لا يمنع نجاح العملية
      console.error('🎫 REST: Failed to broadcast message via socket:', socketErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'تم إضافة الرسالة بنجاح',
      data: {
        id: message.id,
        senderType: message.senderType,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error adding ticket message:', error);
    res.status(500).json({ success: false, error: 'خطأ في إضافة الرسالة' });
  }
}

// ── GET /api/v1/support/tickets/:ticketId/messages ───
async function getTicketMessagesHandler(req, res) {
  try {
    const userId = req.user.userId;
    const { ticketId } = req.params;

    // التحقق من وجود التذكرة
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, status: true, subject: true },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'التذكرة غير موجودة' });
    }

    // السماح لصاحب التذكرة أو ADMIN بمشاهدة الرسائل
    const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'admin';
    if (ticket.userId !== userId && !isAdmin) {
      return res.status(403).json({ success: false, error: 'غير مصرح لك بمشاهدة رسائل هذه التذكرة' });
    }

    // جلب جميع رسائل التذكرة
    const messages = await prisma.supportMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        senderType: true,
        text: true,
        createdAt: true,
      },
    });

    res.json({
      success: true,
      ticket: {
        id: ticket.id,
        status: ticket.status,
        subject: ticket.subject,
      },
      messages: messages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching ticket messages:', error);
    res.status(500).json({ success: false, error: 'خطأ في جلب رسائل التذكرة' });
  }
}

// ═══════════════════════════════════════════════════════
//  LEGACY HANDLERS (مُحدَّثة للتوافق مع الـ schema الجديد)
// ═══════════════════════════════════════════════════════

// ── User: إرسال رسالة دعم (ينشئ تذكرة إن لم توجد مفتوحة) ──
async function createUserMessageHandler(req, res) {
  try {
    const userId = req.user.userId;
    const { text } = req.body;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    }

    // البحث عن تذكرة مفتوحة للمستخدم أو إنشاء واحدة جديدة
    let ticket = await prisma.supportTicket.findFirst({
      where: { userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: { updatedAt: 'desc' },
    });

    if (!ticket) {
      ticket = await prisma.supportTicket.create({
        data: {
          userId,
          subject: 'محادثة دعم',
          status: 'OPEN',
        },
      });
    }

    const message = await prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        userId,
        senderType: 'USER',
        text: text.trim(),
      },
    });

    // تحديث updatedAt
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { updatedAt: new Date() },
    });

    res.status(201).json({
      id: message.id,
      senderType: message.senderType,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
      ticketId: message.ticketId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء إرسال الرسالة' });
  }
}

// ── User: جلب محادثته بالكامل (جميع رسائل تذاكره) ───
async function getUserMessagesHandler(req, res) {
  try {
    const userId = req.user.userId;
    const messages = await prisma.supportMessage.findMany({
      where: {
        ticket: { userId },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        ticket: { select: { id: true, subject: true, status: true } },
      },
    });
    res.json(
      messages.map((m) => ({
        id: m.id,
        ticketId: m.ticketId,
        ticketSubject: m.ticket.subject,
        ticketStatus: m.ticket.status,
        senderType: m.senderType,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء جلب المحادثة' });
  }
}

// ── Admin: قائمة المحادثات (مستخدم واحد لكل مدخل) ────
async function listConversationsHandler(req, res) {
  try {
    const tickets = await prisma.supportTicket.findMany({
      distinct: ['userId'],
      select: { userId: true },
      orderBy: { updatedAt: 'desc' },
    });

    const conversations = await Promise.all(
      tickets.map(async ({ userId }) => {
        const lastTicket = await prisma.supportTicket.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          include: {
            user: { select: { firstName: true, lastName: true } },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });
        const lastMessage = lastTicket?.messages?.[0];
        return {
          userId,
          userName: `${lastTicket?.user?.firstName || ''} ${lastTicket?.user?.lastName || ''}`.trim() || 'مستخدم',
          lastMessage: lastMessage?.text || '',
          lastSenderType: lastMessage?.senderType || null,
          lastAt: lastTicket?.updatedAt?.toISOString() || null,
          ticketId: lastTicket?.id || null,
        };
      })
    );

    res.json(conversations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء جلب المحادثات' });
  }
}

// ── Admin: محادثة مستخدم معيّن (جميع تذاكره مع رسائلها) ──
async function getAdminUserMessagesHandler(req, res) {
  try {
    const { userId } = req.params;

    const tickets = await prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // تحويل إلى قائمة رسائل مسطحة مع بيانات التذكرة
    const flatMessages = tickets.flatMap((ticket) =>
      ticket.messages.map((m) => ({
        id: m.id,
        ticketId: m.ticketId,
        ticketSubject: ticket.subject,
        ticketStatus: ticket.status,
        senderType: m.senderType,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      }))
    );

    res.json(flatMessages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء جلب محادثة المستخدم' });
  }
}

// ── Admin: رد بدور ADMIN على تذكرة مستخدم ────────────
async function createAdminMessageHandler(req, res) {
  try {
    const { userId } = req.params;
    const { text } = req.body;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // البحث عن آخر تذكرة مفتوحة للمستخدم
    let ticket = await prisma.supportTicket.findFirst({
      where: { userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: { updatedAt: 'desc' },
    });

    if (!ticket) {
      return res.status(400).json({ error: 'لا توجد تذكرة مفتوحة لهذا المستخدم' });
    }

    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          userId,
          senderType: 'ADMIN',
          text: text.trim(),
        },
      });

      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { updatedAt: new Date() },
      });

      return newMessage;
    });

    res.status(201).json({
      id: message.id,
      ticketId: message.ticketId,
      senderType: message.senderType,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء إرسال الرد' });
  }
}

module.exports = {
  // New ticket-based handlers
  getFAQsHandler,
  createTicketHandler,
  getUserTicketsHandler,
  getTicketDetailsHandler,
  addTicketMessageHandler,
  getTicketMessagesHandler,
  // Legacy handlers (updated for new schema)
  createUserMessageHandler,
  getUserMessagesHandler,
  listConversationsHandler,
  getAdminUserMessagesHandler,
  createAdminMessageHandler,
};
