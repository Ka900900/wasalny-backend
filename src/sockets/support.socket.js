/**
 * Support Chat Socket.IO handler
 * إدارة نظام الشات اللحظي لتذاكر الدعم الفني
 */
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'wasalny_super_secret_key_change_me';

/**
 * Initialize support chat socket events on the given IO instance.
 * @param {import('socket.io').Server} io
 */
function initSupportSocket(io) {
  // Middleware للتحقق من JWT
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new Error('❌ Authentication required: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded; // { userId, role }
      next();
    } catch (err) {
      return next(new Error('❌ Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.user || {};
    console.log(`🎫 Support socket connected: ${socket.id} (user: ${userId}, role: ${role})`);

    // ── join_support_ticket: الانضمام لغرفة التذكرة ──
    socket.on('join_support_ticket', (data) => {
      const { ticketId } = data || {};
      if (!ticketId) {
        return socket.emit('error', { message: 'ticketId مطلوب' });
      }

      // التحقق من وجود التذكرة وصلاحية الوصول
      prisma.supportTicket
        .findUnique({
          where: { id: ticketId },
          select: { id: true, userId: true },
        })
        .then((ticket) => {
          if (!ticket) {
            return socket.emit('error', { message: 'التذكرة غير موجودة' });
          }

          // السماح بصاحب التذكرة أو ADMIN بالدخول
          const isOwner = ticket.userId === userId;
          const isAdmin = role === 'ADMIN' || role === 'admin';

          if (!isOwner && !isAdmin) {
            return socket.emit('error', { message: 'غير مصرح لك بالوصول إلى هذه التذكرة' });
          }

          const room = `support_${ticketId}`;
          socket.join(room);
          console.log(`🎫 User ${userId} (${role}) joined room ${room}`);
          socket.emit('joined_support_ticket', { ticketId, room });
        })
        .catch((err) => {
          console.error('🎫 Error verifying ticket access:', err.message);
          socket.emit('error', { message: 'خطأ في التحقق من التذكرة' });
        });
    });

    // ── send_support_message: إرسال رسالة دعم جديدة ──
    socket.on('send_support_message', async (data) => {
      const { ticketId, text } = data || {};

      if (!ticketId || !text) {
        return socket.emit('error', { message: 'ticketId و text مطلوبان' });
      }

      try {
        // التحقق من وجود التذكرة وصلاحية الوصول
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: ticketId },
          select: { id: true, userId: true, status: true },
        });

        if (!ticket) {
          return socket.emit('error', { message: 'التذكرة غير موجودة' });
        }

        const isOwner = ticket.userId === userId;
        const isAdmin = role === 'ADMIN' || role === 'admin';

        if (!isOwner && !isAdmin) {
          return socket.emit('error', { message: 'غير مصرح لك بإرسال رسالة لهذه التذكرة' });
        }

        if (ticket.status !== 'OPEN' && ticket.status !== 'IN_PROGRESS') {
          return socket.emit('error', { message: 'لا يمكن إضافة رسالة لتذكرة مغلقة' });
        }

        // تحديد senderType
        const senderType = isAdmin ? 'ADMIN' : 'USER';

        // حفظ الرسالة في قاعدة البيانات
        const message = await prisma.supportMessage.create({
          data: {
            ticketId,
            userId,
            senderType,
            text: text.trim(),
          },
        });

        // تحديث وقت التذكرة
        await prisma.supportTicket.update({
          where: { id: ticketId },
          data: { updatedAt: new Date() },
        });

        // بث الرسالة لجميع المتواجدين في غرفة التذكرة
        const room = `support_${ticketId}`;
        io.to(room).emit('receive_support_message', {
          id: message.id,
          ticketId: message.ticketId,
          senderType: message.senderType,
          text: message.text,
          createdAt: message.createdAt.toISOString(),
        });

        console.log(`🎫 Support message sent in ticket ${ticketId} from ${userId} (${senderType})`);
      } catch (err) {
        console.error('🎫 Error saving support message:', err.message);
        socket.emit('error', { message: 'فشل في إرسال الرسالة' });
      }
    });

    // ── leave_support_ticket: مغادرة غرفة التذكرة ──
    socket.on('leave_support_ticket', (data) => {
      const { ticketId } = data || {};
      if (ticketId) {
        const room = `support_${ticketId}`;
        socket.leave(room);
        console.log(`🎫 User ${userId} left room ${room}`);
      }
    });

    // ── disconnect ──────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`🎫 Support socket disconnected: ${socket.id} (user: ${userId}, reason: ${reason})`);
    });
  });
}

module.exports = { initSupportSocket };
