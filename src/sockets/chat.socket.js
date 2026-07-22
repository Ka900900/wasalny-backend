/**
 * Chat Socket.IO handler
 * إدارة نظام الشات اللحظي للرحلات
 */
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'wasalny_super_secret_key_change_me';

/**
 * Initialize chat socket events on the given IO instance.
 * @param {import('socket.io').Server} io
 */
function initChatSocket(io) {
  // Middleware للتحقق من JWT
  io.use((socket, next) => {
    // محاولة استخراج التوكن من handshake.auth أو headers
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
    console.log(`💬 Chat socket connected: ${socket.id} (user: ${userId}, role: ${role})`);

    // ── join_trip: الانضمام لغرفة الرحلة ──────────
    socket.on('join_trip', (data) => {
      const { tripId } = data || {};
      if (!tripId) {
        return socket.emit('error', { message: 'tripId مطلوب' });
      }
      const room = `trip_${tripId}`;
      socket.join(room);
      console.log(`💬 User ${userId} joined room ${room}`);
      socket.emit('joined_trip', { tripId, room });
    });

    // ── send_message: إرسال رسالة جديدة ────────────
    socket.on('send_message', async (data) => {
      const { tripId, receiverId, content, type = 'TEXT' } = data || {};

      if (!tripId || !receiverId || !content) {
        return socket.emit('error', { message: 'tripId, receiverId, content مطلوبة' });
      }

      try {
        // حفظ الرسالة في قاعدة البيانات
        const message = await prisma.message.create({
          data: {
            tripId,
            senderId: userId,
            receiverId,
            content,
            type,
          },
          include: {
            sender: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        });

        // بث الرسالة لجميع المتواجدين في غرفة الرحلة
        const room = `trip_${tripId}`;
        io.to(room).emit('new_message', {
          ...message,
          createdAt: message.createdAt.toISOString(),
        });

        console.log(`💬 Message sent in trip ${tripId} from ${userId} to ${receiverId}`);
      } catch (err) {
        console.error('💬 Error saving message:', err.message);
        socket.emit('error', { message: 'فشل في إرسال الرسالة' });
      }
    });

    // ── typing: بث حالة الكتابة ────────────────────
    socket.on('typing', (data) => {
      const { tripId, isTyping } = data || {};

      if (!tripId) {
        return socket.emit('error', { message: 'tripId مطلوب' });
      }

      const room = `trip_${tripId}`;
      // إرسال للجميع في الغرفة باستثناء المرسل
      socket.to(room).emit('user_typing', {
        userId,
        isTyping: !!isTyping,
        tripId,
      });
    });

    // ── leave_trip: مغادرة غرفة الرحلة ─────────────
    socket.on('leave_trip', (data) => {
      const { tripId } = data || {};
      if (tripId) {
        const room = `trip_${tripId}`;
        socket.leave(room);
        console.log(`💬 User ${userId} left room ${room}`);
      }
    });

    // ── disconnect ──────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`💬 Chat socket disconnected: ${socket.id} (user: ${userId}, reason: ${reason})`);
    });
  });
}

module.exports = { initChatSocket };
