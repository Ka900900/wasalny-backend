/**
 * Socket.IO service for real-time communication
 * between the backend, passenger app, and captain app.
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/user.repository');

const JWT_SECRET = process.env.JWT_SECRET || 'wasalny_super_secret_key_change_me';

/**
 * Socket event names matching the Flutter passenger app expectations.
 */
const SocketEvents = {
  DRIVER_FOUND: 'ride.driver_found',
  REQUEST_UPDATE: 'ride.request_update',
  DRIVER_LOCATION: 'ride.driver_location',
  RIDE_ACCEPTED: 'ride.accepted',
  RIDE_STARTED: 'ride.started',
  RIDE_COMPLETED: 'ride.completed',
  RIDE_CANCELLED: 'ride.cancelled',
  RIDE_STATUS_UPDATE: 'ride.status_update',
  LOCATION_UPDATE: 'tracking.location_update',
  ETA_UPDATE: 'tracking.eta_update',
  NEW_NOTIFICATION: 'notification.new',
  RIDE_REQUEST: 'ride.request',
  TRACKING_START: 'tracking:start',
  TRACKING_STOP: 'tracking:stop',
  CANCEL_RIDE: 'ride.cancel',
  NEW_RIDE_AVAILABLE: 'ride.new_available',
  DRIVER_ONLINE: 'driver.online',
  DRIVER_OFFLINE: 'driver.offline',
};

/**
 * Initialize Socket.IO server.
 */
function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded;
      } catch (err) {
        socket.user = null;
      }
    } else {
      socket.user = null;
    }
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.userId;
    const role = socket.user?.role;
    console.log(`🔌 Socket connected: ${socket.id} (user: ${userId || 'anonymous'}, role: ${role || 'none'})`);

    if (userId) {
      socket.join(`user:${userId}`);
    }

    if (role === 'DRIVER') {
      socket.join('drivers');
    } else if (role === 'RIDER') {
      socket.join('riders');
    }

    socket.on(SocketEvents.RIDE_REQUEST, (data) => {
      console.log(`🚗 Ride requested by ${userId}:`, data?.rideId);
      io.to('drivers').emit(SocketEvents.NEW_RIDE_AVAILABLE, {
        ...data,
        _timestamp: new Date().toISOString(),
      });
    });

    socket.on(SocketEvents.TRACKING_START, (data) => {
      console.log(`📍 Tracking started for ride ${data?.rideId}`);
      if (data?.rideId) {
        socket.join(`ride:${data.rideId}`);
      }
    });

    socket.on(SocketEvents.TRACKING_STOP, (data) => {
      console.log(`📍 Tracking stopped for ride ${data?.rideId}`);
      if (data?.rideId) {
        socket.leave(`ride:${data.rideId}`);
      }
    });

    // ── Captain (Driver) live events ──────────────
    socket.on('join_driver', (data) => {
      const driverId = data?.userId || userId;
      if (driverId) {
        socket.join(`driver:${driverId}`);
        socket.join('drivers');
        console.log(`🚖 Driver joined room: ${driverId}`);
      }
    });

    socket.on('update-location', (data) => {
      const { lat, lng, rideId } = data || {};
      if (lat == null || lng == null) {
        console.warn(`⚠️ Invalid location payload from ${userId}`);
        return;
      }
      console.log(`📍 Location update from ${userId}:`, lat, lng);
      if (rideId) {
        emitDriverLocation(io, rideId, lat, lng);
      }
    });

    socket.on(SocketEvents.CANCEL_RIDE, (data) => {
      console.log(`❌ Ride cancelled via socket: ${data?.rideId}`);
      io.to(`ride:${data?.rideId}`).emit(SocketEvents.RIDE_CANCELLED, {
        rideId: data?.rideId,
        reason: data?.reason || 'تم الإلغاء من قبل المستخدم',
        _timestamp: new Date().toISOString(),
      });
    });

    socket.on('disconnect', async (reason) => {
      console.log(`🔌 Socket disconnected: ${socket.id} (user: ${userId || 'anonymous'}, role: ${role || 'none'}, ${reason})`);

      // ── تأمين حالة الكابتن عند الفصل المفاجئ (App Kill / انقطاع الإنترنت) ──
      // عند فصل أي كابتن، نحدّث حالته في Postgres إلى غير متاح (isAvailable = false)
      // ونبثّ حدثاً لغرفة الكباتن (والركاب) لإعلامهم بخروجه من التوفّر.
      if (role === 'DRIVER' && userId) {
        try {
          await userRepository.setDriverAvailability(userId, false);
          console.log(`🚖 Driver ${userId} marked OFFLINE (isAvailable=false) on disconnect`);

          io.to('drivers').emit(SocketEvents.DRIVER_OFFLINE, {
            driverId: userId,
            isAvailable: false,
            reason,
            _timestamp: new Date().toISOString(),
          });
        } catch (err) {
          // غير حرج: فشل التحديث لا يكسر تدفق السوكيت
          console.error('⚠️ Failed to mark driver offline on disconnect (non-fatal):', err.message);
        }
      }
    });
  });

  return io;
}

function emitRideStatus(io, rideId, status, data = {}) {
  io.to(`ride:${rideId}`).emit(SocketEvents.RIDE_STATUS_UPDATE, {
    rideId,
    status,
    ...data,
    _timestamp: new Date().toISOString(),
  });

  const eventMap = {
    ACCEPTED: SocketEvents.RIDE_ACCEPTED,
    STARTED: SocketEvents.RIDE_STARTED,
    COMPLETED: SocketEvents.RIDE_COMPLETED,
    CANCELLED: SocketEvents.RIDE_CANCELLED,
  };
  const specificEvent = eventMap[status];
  if (specificEvent) {
    io.to(`ride:${rideId}`).emit(specificEvent, {
      rideId,
      status,
      ...data,
      _timestamp: new Date().toISOString(),
    });
  }
}

function emitDriverLocation(io, rideId, lat, lng, etaMinutes) {
  io.to(`ride:${rideId}`).emit(SocketEvents.DRIVER_LOCATION, {
    rideId,
    latitude: lat,
    longitude: lng,
    eta_minutes: etaMinutes,
    _timestamp: new Date().toISOString(),
  });

  io.to(`ride:${rideId}`).emit(SocketEvents.LOCATION_UPDATE, {
    rideId,
    lat,
    lng,
    _timestamp: new Date().toISOString(),
  });
}

function emitEtaUpdate(io, rideId, etaMinutes, remainingDistance, remainingDuration) {
  io.to(`ride:${rideId}`).emit(SocketEvents.ETA_UPDATE, {
    ride_id: rideId,
    eta_minutes: etaMinutes,
    remaining_distance: remainingDistance,
    remaining_duration: remainingDuration,
    _timestamp: new Date().toISOString(),
  });
}

function sendNotification(io, userId, notification) {
  io.to(`user:${userId}`).emit(SocketEvents.NEW_NOTIFICATION, {
    ...notification,
    _timestamp: new Date().toISOString(),
  });
}

module.exports = {
  initSocket,
  SocketEvents,
  emitRideStatus,
  emitDriverLocation,
  emitEtaUpdate,
  sendNotification,
};
