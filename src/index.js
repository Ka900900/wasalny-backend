require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const { authenticateToken, requireRole, generateToken } = require('./middleware/auth');
const { validate } = require('./middleware/validate');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { initSocket, emitRideStatus, emitDriverLocation, emitEtaUpdate, sendNotification, SocketEvents } = require('./config/socket');
const { createKashierSession, verifyWebhookSignature, queryKashierTransaction } = require('./services/kashier');
const { initFirebase, verifyFirebaseToken } = require('./config/firebase');
const { calculateDistance, calculateFare, estimateDuration, getPricePerKm, haversineDistance } = require('./services/geo');
const { settleRide } = require('./services/ride.service');
const prisma = require('./config/prisma');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const captainsRoutes = require('./routes/captains.routes');
const ridesRoutes = require('./routes/rides.routes');
const walletRoutes = require('./routes/wallet.routes');
const adminRoutes = require('./routes/admin.routes');
const supportRoutes = require('./routes/support.routes');
const safetyRoutes = require('./routes/safety.routes');
const { rateRideHandler } = require('./controllers/ride.controller');

// Validators
const {
  registerDriverSchema,
  firebaseLoginSchema,
} = require('./validators/auth.validator');
const {
  requestRideSchema,
  updateLocationSchema,
  rateRideSchema,
} = require('./validators/ride.validator');
const { withdrawSchema, topUpSchema } = require('./validators/wallet.validator');
const uploadRoutes = require('./routes/upload.routes');

// ── App Setup ────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy so express-rate-limit can read the real client IP
app.set('trust proxy', 1);

// ── Swagger Config ───────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Waslny API — وصلني',
      version: '2.0.0',
      description: 'API for Waslny ride-hailing platform (الكابتن والمسافر)',
    },
    servers: [
      { url: `http://localhost:${PORT}`, description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/index.js'],
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Waslny API Docs',
}));

// ── Rate Limiting ────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: { error: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'طلبات كثيرة جداً، حاول بعد دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Middleware ───────────────────────────────────────
app.use(cors());
app.use(generalLimiter);

// جعل express.json() شرطياً حتى لا يتعارض مع Multer في رفع الملفات
const jsonParser = express.json();
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  // Skip JSON parser for multipart requests — multer handles those
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  jsonParser(req, res, next);
});

// >>> TEMP: request logger (live monitoring) <<<
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[REQ] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});
// >>> END TEMP <<<

// ── Socket.IO ────────────────────────────────────────
const io = initSocket(server);
app.locals.io = io;

// ── Routes ───────────────────────────────────────────
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/auth', authRoutes);

// ── Alias صريح لضمان نجاح طلبات العميل لـ /api/v1/auth/register-fcm-token ──
const authController = require('./controllers/auth.controller');
app.post('/api/v1/auth/register-fcm-token', authenticateToken, authController.registerFcmToken);
app.use('/api/v1/user', usersRoutes);
app.use('/api/v1/captain', captainsRoutes);
app.use('/api/v1/rides', ridesRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/support', supportRoutes);
app.use('/api/v1/safety', safetyRoutes);
app.use('/api/v1/upload', uploadRoutes);

// ── Helper: Ensure Wallet exists ─────────────────────
async function ensureWallet(userId) {
  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId, balance: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
    });
  }
  return wallet;
}

// ═══════════════════════════════════════════════════════
//  API V1 ROUTES
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server is running
 */
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/v1/rate', authenticateToken, validate(require('./validators/ride.validator').rateRideSchema), rateRideHandler);

// ═══════════════════════════════════════════════════════
//  AUTH ENDPOINTS  /api/v1/auth
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/auth/register-driver:
 *   post:
 *     summary: Register as a driver (captain)
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [carModel, carPlateNumber, carColor, vehicleType, carPhotoUrl]
 *             properties:
 *               carModel: { type: string }
 *               carPlateNumber: { type: string }
 *               carColor: { type: string }
 *               vehicleType: { type: string, enum: [PRIVATE_CAR, TAXI, SCOOTER, MOTORCYCLE] }
 *               carPhotoUrl: { type: string, format: uri }
 *     responses:
 *       201:
 *         description: Driver registered successfully
 */
app.post('/api/v1/auth/register-driver', authenticateToken, validate(registerDriverSchema), async (req, res) => {
  if (req.user.role === 'DRIVER') {
    return res.status(400).json({ error: 'أنت بالفعل مسجل ككابتن' });
  }
  const { phoneNumber, carModel, carPlateNumber, carColor, vehicleType, carPhotoUrl } = req.body;
  try {
    // نتأكد إن الرقم مش متسجل لحساب تاني
    const existing = await prisma.user.findUnique({ where: { phoneNumber } });
    if (existing && existing.id !== req.user.userId) {
      return res.status(409).json({ error: 'رقم الهاتف مسجل بالفعل لحساب آخر' });
    }

    const driverProfile = await prisma.driverProfile.create({
      data: { userId: req.user.userId, carModel, carPlateNumber, carColor, vehicleType, carPhotoUrl },
    });
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { phoneNumber, role: 'DRIVER' },
    });
    // Ensure wallet exists
    await ensureWallet(req.user.userId);

    const newToken = generateToken(req.user.userId, 'DRIVER');
    res.status(201).json({
      message: 'تم التسجيل ككابتن بنجاح',
      driverProfile,
      token: newToken,
    });
  } catch (error) {
    console.error('[register-driver] ERROR details:', error?.message || error);
    console.error('[register-driver] user role at failure =', req.user?.role);
    // التعامل مع خطأ unique constraint على رقم الهاتف
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'رقم الهاتف مسجل بالفعل' });
    }
    res.status(500).json({ error: 'حدث خطأ أثناء التسجيل ككابتن' });
  }
});

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Refresh JWT token
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: New token
 */
app.post('/api/v1/auth/refresh', authenticateToken, (req, res) => {
  const token = generateToken(req.user.userId, req.user.role);
  res.json({ token, message: 'تم تجديد التوكن' });
});

/**
 * @swagger
 * /api/v1/auth/firebase-login:
 *   post:
 *     summary: Login with Firebase ID Token (primary auth method)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firebaseIdToken]
 *             properties:
 *               firebaseIdToken: { type: string }
 *     responses:
 *       200:
 *         description: Login successful, returns Waslny JWT
 */
app.post('/api/v1/auth/firebase-login', validate(firebaseLoginSchema), async (req, res) => {
  const { firebaseIdToken } = req.body;

  try {
    // Verify Firebase token
    const decodedToken = await verifyFirebaseToken(firebaseIdToken);
    const { uid, phoneNumber, displayName, email } = decodedToken;

    // نقبل تسجيل الدخول حتى لو مفيش رقم هاتف من Firebase (جوجل مثلاً)
    // نخزن placeholder فريد مؤقتاً لحد ما يتحدث في register-driver
    const safePhone = phoneNumber || `firebase:${uid}`;

    // Parse display name
    let firstName = null;
    let lastName = null;
    if (displayName) {
      const parts = displayName.trim().split(/\s+/);
      firstName = parts[0] || null;
      lastName = parts.slice(1).join(' ') || null;
    }

    // Find or create user (نبحث بـ firebaseUid أولاً لأن الرقم ممكن يكون placeholder)
    let user = await prisma.user.findUnique({ where: { firebaseUid: uid } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { phoneNumber: safePhone } });
    }

    if (user) {
      // Update existing user
      const updateData = {};
      if (firstName && !user.firstName) updateData.firstName = firstName;
      if (lastName && !user.lastName) updateData.lastName = lastName;
      if (Object.keys(updateData).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          firebaseUid: uid,
          phoneNumber: safePhone, // placeholder فريد، يتحدث في register-driver
          email: email || null,
          firstName: firstName || 'مستخدم',
          lastName: lastName || 'جديد',
          isVerified: true, // Firebase verified
        },
      });
      // Create wallet for new user
      await ensureWallet(user.id);
    }

    // Generate Waslny JWT
    const token = generateToken(user.id, user.role);

    res.json({
      success: true,
      token,
      refreshToken: token, // Same token for now, can be extended later
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isVerified: true,
      },
    });
  } catch (error) {
    console.error('Firebase login error:', error);

    // Handle Firebase specific errors
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'رمز Firebase منتهي الصلاحية' });
    }
    if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ error: 'رمز Firebase غير صالح' });
    }

    res.status(500).json({ error: 'خطأ في تسجيل الدخول' });
  }
});

// ═══════════════════════════════════════════════════════
//  RIDE ENDPOINTS  /api/v1/rides
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/rides/options:
 *   get:
 *     summary: Get available ride options (economy, comfort, premium, xl)
 *     tags: [Rides]
 *     responses:
 *       200:
 *         description: List of ride options
 */
app.get('/api/v1/rides/options', async (req, res) => {
  try {
    let options = await prisma.rideOption.findMany({
      where: { isActive: true },
      orderBy: { pricePerKm: 'asc' },
    });

    // Seed default options if none exist
    if (options.length === 0) {
      const defaultOptions = [
        { name: 'economy', nameAr: 'اقتصادي', description: 'Cheapest option', descriptionAr: 'الخيار الأرخص', icon: 'economy', capacity: 4, baseFare: 10, pricePerKm: 4, pricePerMinute: 0.75, multiplier: 1.0 },
        { name: 'comfort', nameAr: 'مريح', description: 'Comfortable ride', descriptionAr: 'رحلة مريحة', icon: 'comfort', capacity: 4, baseFare: 15, pricePerKm: 6, pricePerMinute: 1.0, multiplier: 1.0 },
        { name: 'premium', nameAr: 'ممتاز', description: 'Luxury vehicles', descriptionAr: 'سيارات فاخرة', icon: 'premium', capacity: 4, baseFare: 25, pricePerKm: 10, pricePerMinute: 1.5, multiplier: 1.5 },
        { name: 'xl', nameAr: 'عائلي', description: 'Family vehicles', descriptionAr: 'سيارات عائلية', icon: 'xl', capacity: 6, baseFare: 20, pricePerKm: 8, pricePerMinute: 1.25, multiplier: 1.2 },
      ];
      for (const opt of defaultOptions) {
        await prisma.rideOption.create({ data: { ...opt, isActive: true } });
      }
      options = await prisma.rideOption.findMany({ where: { isActive: true } });
    }

    res.json({ options });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب خيارات الرحلات' });
  }
});

/**
 * @swagger
 * /api/v1/rides/fare:
 *   get:
 *     summary: Calculate fare for a ride
 *     tags: [Rides]
 *     parameters:
 *       - in: query
 *         name: originLat
 *         schema: { type: number }
 *         required: true
 *       - in: query
 *         name: originLng
 *         schema: { type: number }
 *         required: true
 *       - in: query
 *         name: destLat
 *         schema: { type: number }
 *         required: true
 *       - in: query
 *         name: destLng
 *         schema: { type: number }
 *         required: true
 *       - in: query
 *         name: rideType
 *         schema: { type: string, enum: [economy, comfort, premium, xl] }
 *     responses:
 *       200:
 *         description: Fare estimation
 */
app.get('/api/v1/rides/fare', async (req, res) => {
  const { originLat, originLng, destLat, destLng, rideType } = req.query;
  if (!originLat || !originLng || !destLat || !destLng) {
    return res.status(400).json({ error: 'الإحداثيات مطلوبة' });
  }

  try {
    const lat1 = parseFloat(originLat);
    const lng1 = parseFloat(originLng);
    const lat2 = parseFloat(destLat);
    const lng2 = parseFloat(destLng);

    const distanceKm = await calculateDistance(lat1, lng1, lat2, lng2);
    const durationMin = estimateDuration(distanceKm, 25);

    let multiplier = 1.0;
    if (rideType) {
      const option = await prisma.rideOption.findUnique({ where: { id: rideType } });
      if (!option) {
        const opt = await prisma.rideOption.findFirst({ where: { name: rideType, isActive: true } });
        if (opt) multiplier = opt.multiplier;
      } else {
        multiplier = option.multiplier;
      }
    }

    const commissionRate = await getCommissionRate();
    const baseFare = calculateFare({
      distanceKm,
      durationMinutes: durationMin,
      baseFare: rideOption?.baseFare ? parseFloat(rideOption.baseFare.toString()) : 0,
      pricePerKm: getPricePerKm(),
      pricePerMinute: rideOption?.pricePerMinute ? parseFloat(rideOption.pricePerMinute.toString()) : 0,
      commissionRate,
    });
    const finalPrice = parseFloat((baseFare.price * multiplier).toFixed(2));
    const commission = parseFloat((finalPrice * commissionRate).toFixed(2));

    res.json({
      distance: parseFloat(distanceKm.toFixed(2)),
      durationMinutes: durationMin,
      pricePerKm: baseFare.pricePerKm,
      multiplier,
      basePrice: baseFare.price,
      finalPrice,
      commission,
      driverEarning: parseFloat((finalPrice - commission).toFixed(2)),
      isPeakHour: getPricePerKm() > 7,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في حساب السعر' });
  }
});

/**
 * @swagger
 * /api/v1/rides/request:
 *   post:
 *     summary: Request a new ride
 *     tags: [Rides]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [originLat, originLng, destLat, destLng]
 *             properties:
 *               pickupAddress: { type: string }
 *               destinationAddress: { type: string }
 *               originLat: { type: number }
 *               originLng: { type: number }
 *               destLat: { type: number }
 *               destLng: { type: number }
 *               rideType: { type: string, enum: [economy, comfort, premium, xl] }
 *               paymentMethod: { type: string, enum: [cash, wallet, card] }
 *     responses:
 *       201:
 *         description: Ride requested successfully
 */
app.post('/api/v1/rides/request', authenticateToken, validate(requestRideSchema), async (req, res) => {
  const {
    pickupAddress, destinationAddress,
    pickupPoint, dropoffPoint,
    originLat, originLng, destLat, destLng,
    rideType, paymentMethod,
  } = req.body;

  try {
    const distanceKm = await calculateDistance(originLat, originLng, destLat, destLng);
    const durationMin = estimateDuration(distanceKm, 25);

    let rideTypeName = rideType || 'economy';
    let multiplier = 1.0;
    const rideOption = await prisma.rideOption.findFirst({
      where: { name: rideTypeName, isActive: true },
    });
    if (rideOption) multiplier = rideOption.multiplier;

    const commissionRate = await getCommissionRate();
    const base = calculateFare({
      distanceKm,
      durationMinutes: durationMin,
      baseFare: rideOption?.baseFare ? parseFloat(rideOption.baseFare.toString()) : 0,
      pricePerKm: getPricePerKm(),
      pricePerMinute: rideOption?.pricePerMinute ? parseFloat(rideOption.pricePerMinute.toString()) : 0,
      commissionRate,
    });
    const finalPrice = parseFloat((base.price * multiplier).toFixed(2));
    const commission = parseFloat((finalPrice * commissionRate).toFixed(2));
    const driverEarning = parseFloat((finalPrice - commission).toFixed(2));

    const newRide = await prisma.rideRequest.create({
      data: {
        riderId: req.user.userId,
        pickupPoint: pickupPoint || '', // Fallback: use `pickupPoint` or empty
        pickupAddress: pickupAddress || '',
        dropoffPoint: dropoffPoint || '',
        destinationAddress: destinationAddress || '',
        originLat: parseFloat(originLat),
        originLng: parseFloat(originLng),
        destLat: parseFloat(destLat),
        destLng: parseFloat(destLng),
        rideType: rideTypeName,
        rideOptionId: rideOption?.id || null,
        price: finalPrice,
        distance: parseFloat(distanceKm.toFixed(2)),
        durationMinutes: durationMin,
        pricePerKm: base.pricePerKm,
        commission,
        driverEarning,
        paymentMethod: paymentMethod || 'cash',
        status: 'PENDING',
      },
    });

    // Notify all drivers via Socket.IO
    io.to('drivers').emit(SocketEvents.NEW_RIDE_AVAILABLE, {
      rideId: newRide.id,
      pickupAddress: newRide.pickupAddress || newRide.pickupPoint,
      destinationAddress: newRide.destinationAddress || newRide.dropoffPoint,
      originLat: newRide.originLat,
      originLng: newRide.originLng,
      destLat: newRide.destLat,
      destLng: newRide.destLng,
      price: newRide.price,
      distance: newRide.distance,
      rideType: newRide.rideType,
      _timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      message: 'تم طلب الرحلة بنجاح!',
      ride: {
        id: newRide.id,
        status: newRide.status,
        pickupAddress: newRide.pickupAddress || newRide.pickupPoint,
        destinationAddress: newRide.destinationAddress || newRide.dropoffPoint,
        originLat: newRide.originLat,
        originLng: newRide.originLng,
        destLat: newRide.destLat,
        destLng: newRide.destLng,
        rideType: newRide.rideType,
        price: newRide.price,
        distance: newRide.distance,
        durationMinutes: newRide.durationMinutes,
        pricePerKm: newRide.pricePerKm,
        commission: newRide.commission,
        driverEarning: newRide.driverEarning,
        paymentMethod: newRide.paymentMethod,
        createdAt: newRide.createdAt,
      },
    });
  } catch (error) {
    console.error('Request ride error:', error.response?.data || error.message);

    // Fallback with Haversine
    const fallbackDistance = haversineDistance(originLat, originLng, destLat, destLng);
    const fallbackDuration = estimateDuration(fallbackDistance);
    const base = calculateFare(fallbackDistance);
    const fallbackPrice = base.price;
    const commission = base.commission;
    const driverEarning = base.driverEarning;

    try {
      const newRide = await prisma.rideRequest.create({
        data: {
          riderId: req.user.userId,
          pickupPoint: pickupPoint || '',
          pickupAddress: pickupAddress || '',
          dropoffPoint: dropoffPoint || '',
          destinationAddress: destinationAddress || '',
          originLat: parseFloat(originLat),
          originLng: parseFloat(originLng),
          destLat: parseFloat(destLat),
          destLng: parseFloat(destLng),
          rideType: rideType || 'economy',
          price: fallbackPrice,
          distance: parseFloat(fallbackDistance.toFixed(2)),
          durationMinutes: fallbackDuration,
          pricePerKm: base.pricePerKm,
          commission,
          driverEarning,
          paymentMethod: paymentMethod || 'cash',
          status: 'PENDING',
        },
      });
      res.status(201).json({
        message: 'تم طلب الرحلة (تقديري)',
        ride: newRide,
        note: 'تم حساب المسافة تقريبياً بسبب خطأ في خدمة الخرائط',
      });
    } catch (dbError) {
      console.error('Fallback DB error:', dbError);
      res.status(500).json({ error: 'حدث خطأ أثناء حفظ الرحلة' });
    }
  }
});

/**
 * @swagger
 * /api/v1/rides/current:
 *   get:
 *     summary: Get current active ride for the authenticated user
 *     tags: [Rides]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current ride data
 */
app.get('/api/v1/rides/current', authenticateToken, async (req, res) => {
  try {
    const ride = await prisma.rideRequest.findFirst({
      where: {
        OR: [
          { riderId: req.user.userId },
          { driverId: req.user.userId },
        ],
        status: { in: ['PENDING', 'ACCEPTED', 'STARTED'] },
      },
      include: {
        rider: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        driver: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, driverProfile: true } },
        rideOption: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ride: ride || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الرحلة الحالية' });
  }
});

/**
 * @swagger
 * /api/v1/rides/history:
 *   get:
 *     summary: Get ride history for the authenticated user
 *     tags: [Rides]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of past rides
 */
app.get('/api/v1/rides/history', authenticateToken, async (req, res) => {
  try {
    const rides = await prisma.rideRequest.findMany({
      where: {
        OR: [
          { riderId: req.user.userId },
          { driverId: req.user.userId },
        ],
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        rider: { select: { id: true, firstName: true, lastName: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
        rating: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ rides });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب تاريخ الرحلات' });
  }
});

/**
 * @swagger
 * /api/v1/rides/cancel/{rideId}:
 *   put:
 *     summary: Cancel a ride
 *     tags: [Rides]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rideId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ride cancelled
 */
app.put('/api/v1/rides/cancel/:rideId', authenticateToken, async (req, res) => {
  const { rideId } = req.params;
  try {
    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.riderId !== req.user.userId && ride.driverId !== req.user.userId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لإلغاء هذه الرحلة' });
    }
    if (ride.status === 'COMPLETED') return res.status(400).json({ error: 'لا يمكن إلغاء رحلة منتهية' });

    const updated = await prisma.rideRequest.update({
      where: { id: rideId },
      data: { status: 'CANCELLED' },
    });

    emitRideStatus(io, rideId, 'CANCELLED', { cancelledBy: req.user.userId });
    res.json({ message: 'تم إلغاء الرحلة', ride: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في إلغاء الرحلة' });
  }
});

// ═══════════════════════════════════════════════════════
//  DRIVER ENDPOINTS  /api/v1/driver
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/driver/location:
 *   put:
 *     summary: Update driver's current location
 *     tags: [Driver]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number }
 *               lng: { type: number }
 *     responses:
 *       200:
 *         description: Location updated
 */
app.put('/api/v1/driver/location', authenticateToken, requireRole('DRIVER'), validate(updateLocationSchema), async (req, res) => {
  const { lat, lng } = req.body;
  try {
    const updatedProfile = await prisma.driverProfile.update({
      where: { userId: req.user.userId },
      data: { currentLat: lat, currentLng: lng },
    });

    // Emit location to all tracking passengers (via ride rooms)
    const activeRides = await prisma.rideRequest.findMany({
      where: {
        driverId: req.user.userId,
        status: { in: ['ACCEPTED', 'STARTED'] },
      },
      select: { id: true },
    });
    for (const ride of activeRides) {
      emitDriverLocation(io, ride.id, lat, lng, null);
    }

    res.json({ message: 'تم تحديث الموقع', driverProfile: updatedProfile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث الموقع' });
  }
});

/**
 * @swagger
 * /api/v1/driver/available-rides:
 *   get:
 *     summary: Get nearby pending rides for driver
 *     tags: [Driver]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of nearby rides
 */
app.get('/api/v1/driver/available-rides', authenticateToken, requireRole('DRIVER'), async (req, res) => {
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: req.user.userId },
  });
  if (!driverProfile || driverProfile.currentLat === null || driverProfile.currentLng === null) {
    return res.status(400).json({ error: 'موقع الكابتن غير محدد. يرجى تحديث موقعك أولاً.' });
  }

  const SEARCH_RADIUS_KM = parseFloat(process.env.SEARCH_RADIUS_KM) || 5;
  const pendingRides = await prisma.rideRequest.findMany({
    where: { status: 'PENDING' },
    include: { rider: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });

  if (pendingRides.length === 0) {
    return res.json({ message: 'لا توجد رحلات متاحة حالياً', rides: [] });
  }

  const ridesWithDistance = pendingRides
    .map((ride) => ({
      ...ride,
      distanceFromDriver: haversineDistance(
        driverProfile.currentLat,
        driverProfile.currentLng,
        ride.originLat,
        ride.originLng
      ),
    }))
    .filter((ride) => ride.distanceFromDriver <= SEARCH_RADIUS_KM)
    .sort((a, b) => a.distanceFromDriver - b.distanceFromDriver);

  res.json({
    message: `تم العثور على ${ridesWithDistance.length} رحلة قريبة`,
    driverLocation: { lat: driverProfile.currentLat, lng: driverProfile.currentLng },
    searchRadiusKm: SEARCH_RADIUS_KM,
    rides: ridesWithDistance,
  });
});

/**
 * @swagger
 * /api/v1/driver/accept-ride/{rideId}:
 *   post:
 *     summary: Accept a ride (driver)
 *     tags: [Driver]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Ride accepted
 */
app.post('/api/v1/driver/accept-ride/:rideId', authenticateToken, requireRole('DRIVER'), async (req, res) => {
  const { rideId } = req.params;
  try {
    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.status !== 'PENDING') return res.status(400).json({ error: 'الرحلة لم تعد متاحة' });

    const updatedRide = await prisma.rideRequest.update({
      where: { id: rideId },
      data: { driverId: req.user.userId, status: 'ACCEPTED' },
      include: {
        driver: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, driverProfile: true } },
      },
    });

    // Notify passenger via Socket.IO
    emitRideStatus(io, rideId, 'ACCEPTED', {
      driver: {
        driver_id: updatedRide.driver.id,
        driver_name: `${updatedRide.driver.firstName} ${updatedRide.driver.lastName}`,
        phone: updatedRide.driver.phoneNumber,
        vehicle_model: updatedRide.driver.driverProfile?.carModel,
        vehicle_color: updatedRide.driver.driverProfile?.carColor,
        plate_number: updatedRide.driver.driverProfile?.carPlateNumber,
        rating: updatedRide.driver.driverProfile?.ratingAvg,
        total_trips: updatedRide.driver.driverProfile?.totalTrips,
      },
    });

    res.json({ message: 'تم قبول الرحلة', ride: updatedRide });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'حدث خطأ أثناء قبول الرحلة' });
  }
});

/**
 * @swagger
 * /api/v1/driver/ride/start/{rideId}:
 *   put:
 *     summary: Start a ride (driver)
 *     tags: [Driver]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Ride started
 */
app.put('/api/v1/driver/ride/start/:rideId', authenticateToken, requireRole('DRIVER'), async (req, res) => {
  const { rideId } = req.params;
  try {
    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.driverId !== req.user.userId) return res.status(403).json({ error: 'هذه الرحلة ليست مخصصة لك' });
    if (ride.status !== 'ACCEPTED') return res.status(400).json({ error: 'لا يمكن بدء رحلة إلا بعد قبولها' });

    const updated = await prisma.rideRequest.update({
      where: { id: rideId },
      data: { status: 'STARTED' },
    });

    emitRideStatus(io, rideId, 'STARTED');
    res.json({ message: 'تم بدء الرحلة', ride: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في بدء الرحلة' });
  }
});

/**
 * @swagger
 * /api/v1/driver/ride/complete/{rideId}:
 *   put:
 *     summary: Complete a ride (driver)
 *     tags: [Driver]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Ride completed
 */
app.put('/api/v1/driver/ride/complete/:rideId', authenticateToken, requireRole('DRIVER'), async (req, res) => {
  const { rideId } = req.params;
  try {
    const ride = await prisma.rideRequest.findUnique({
      where: { id: rideId },
      select: { id: true, driverId: true, status: true, paymentMethod: true },
    });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.driverId !== req.user.userId) return res.status(403).json({ error: 'هذه الرحلة ليست مخصصة لك' });
    if (ride.status !== 'STARTED') return res.status(400).json({ error: 'لا يمكن إنهاء رحلة لم تبدأ بعد' });

    let result;
    if ((ride.paymentMethod || 'wallet') === 'wallet') {
      // محفظة: تُسوّى مالياً فوراً
      result = await settleRide(null, { rideId, driverId: req.user.userId });
    } else {
      // بطاقة: لا تسوية الآن — تتم بعد تأكيد كاشير (webhook/verify)
      const updated = await prisma.rideRequest.update({ where: { id: rideId }, data: { status: 'COMPLETED' } });
      result = { updatedRide: updated };
    }
    emitRideStatus(io, rideId, 'COMPLETED');
    res.json({ message: 'تم إنهاء الرحلة', ride: result.updatedRide });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في إنهاء الرحلة' });
  }
});

// NOTE: /api/v1/driver/earnings is handled in src/routes/captains.routes.js (getEarningsHandler)

// ═══════════════════════════════════════════════════════
//  WALLET ENDPOINTS  /api/v1/wallet
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/wallet/balance:
 *   get:
 *     summary: Get wallet balance
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Wallet data
 */
app.get('/api/v1/wallet/balance', authenticateToken, async (req, res) => {
  try {
    const wallet = await ensureWallet(req.user.userId);
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { firstName: true, lastName: true },
    });
    res.json({
      balance: wallet.balance,
      pendingWithdraw: wallet.pendingWithdraw,
      totalEarned: wallet.totalEarned,
      totalWithdrawn: wallet.totalWithdrawn,
      fullName: `${user.firstName} ${user.lastName}`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب رصيد المحفظة' });
  }
});

/**
 * @swagger
 * /api/v1/wallet/transactions:
 *   get:
 *     summary: Get wallet transactions
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of transactions
 */
app.get('/api/v1/wallet/transactions', authenticateToken, async (req, res) => {
  try {
    const wallet = await ensureWallet(req.user.userId);
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب المعاملات' });
  }
});

/**
 * @swagger
 * /api/v1/wallet/withdraw:
 *   post:
 *     summary: Request a withdrawal
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, bankName, bankAccount, accountHolder]
 *             properties:
 *               amount: { type: number }
 *               bankName: { type: string }
 *               bankAccount: { type: string }
 *               accountHolder: { type: string }
 *     responses:
 *       201:
 *         description: Withdrawal requested
 */
app.post('/api/v1/wallet/withdraw', authenticateToken, requireRole('DRIVER'), validate(withdrawSchema), async (req, res) => {
  const { amount, bankName, bankAccount, accountHolder } = req.body;
  try {
    const wallet = await ensureWallet(req.user.userId);
    if (wallet.balance < amount) {
      return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    }

    const withdraw = await prisma.withdrawRequest.create({
      data: {
        walletId: wallet.id,
        amount,
        bankName,
        bankAccount,
        accountHolder,
        status: 'pending',
      },
    });

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        pendingWithdraw: { increment: amount },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'withdraw',
        amount: -amount,
        description: `طلب سحب ${amount} ج.م - ${bankName}`,
        status: 'pending',
      },
    });

    res.status(201).json({ message: 'تم تقديم طلب السحب', withdraw });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في طلب السحب' });
  }
});

/**
 * @swagger
 * /api/v1/wallet/withdraws:
 *   get:
 *     summary: Get withdrawal requests history
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of withdrawals
 */
app.get('/api/v1/wallet/withdraws', authenticateToken, requireRole('DRIVER'), async (req, res) => {
  try {
    const wallet = await ensureWallet(req.user.userId);
    const withdraws = await prisma.withdrawRequest.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ withdraws });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب طلبات السحب' });
  }
});

/**
 * @swagger
 * /api/v1/wallet/top-up:
 *   post:
 *     summary: Top up wallet (passenger)
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number }
 *               paymentMethod: { type: string, enum: [card, wallet] }
 *     responses:
 *       200:
 *         description: Top-up initiated
 */
app.post('/api/v1/wallet/top-up', authenticateToken, validate(topUpSchema), async (req, res) => {
  const { amount, paymentMethod } = req.body;
  const userId = req.user.userId;
  try {
    // كل طرق الدفع التي تمر عبر كاشير (بطاقة، محفظة إلكترونية، إنستاباي)
    const kashierMethods = ['card', 'vodafone_cash', 'instapay'];
    if (kashierMethods.includes(paymentMethod)) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const session = await createKashierSession(
        `topup_${userId}_${Date.now()}`,
        amount,
        'شحن محفظة وصلني',
        paymentMethod,
        user
      );
      return res.json({
        message: 'تم إنشاء رابط الدفع',
        paymentUrl: session.paymentUrl,
        sessionUrl: session.sessionUrl,
        sessionId: session.sessionId,
      });
    }

    // طريقة الدفع "wallet" تعني رصيد المحفظة الفعلي — غير مسموح به إلا إذا كان مبلغًا سلبيًا أو مستخدمًا إداريًا
    if (paymentMethod === 'wallet') {
      // يمكنك إضافة منطق هنا إذا كنت تريد السماح بشحن الرصيد من رصيد المحفظة الحالي للمستخدم
      throw new Error('لا يمكن شحن الرصيد من رصيد المحفظة الحالي');
    }

    // غير مسموح به — رفض طرق الدفع غير المدعومة
    throw new Error('طريقة الدفع غير مدعومة');
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في شحن المحفظة' });
  }
});

// ═══════════════════════════════════════════════════════
//  PAYMENT ENDPOINTS  /api/v1/payments
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/payments/kashier/initiate:
 *   post:
 *     summary: Initiate Kashier payment for a ride
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rideId]
 *             properties:
 *               rideId: { type: string }
 *     responses:
 *       200:
 *         description: Payment session created
 */
app.post('/api/v1/payments/kashier/initiate', authenticateToken, async (req, res) => {
  const { rideId } = req.body;
  if (!rideId) return res.status(400).json({ error: 'معرف الرحلة مطلوب' });
  try {
    const ride = await prisma.rideRequest.findUnique({
      where: { id: rideId },
      include: { rider: true },
    });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.riderId !== req.user.userId)
      return res.status(403).json({ error: 'غير مصرح لك بدفع ثمن هذه الرحلة' });
    if (ride.isPaid) return res.status(400).json({ error: 'هذه الرحلة مدفوعة مسبقاً' });

    const session = await createKashierSession(
      rideId,
      ride.price,
      `دفع تكلفة الرحلة رقم ${rideId}`,
      ride.paymentMethod,
      ride.rider
    );
    res.json({
      message: 'تم إنشاء رابط الدفع',
      paymentUrl: session.paymentUrl,
      sessionUrl: session.sessionUrl,
      sessionId: session.sessionId,
    });
  } catch (error) {
    console.error('Kashier error:', error.response?.data || error.message);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء جلسة الدفع' });
  }
});

/**
 * @swagger
 * /api/v1/payments/kashier/verify:
 *   get:
 *     summary: Verify payment status
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: merchant_order_id
 *         schema: { type: string }
 *       - in: query
 *         name: ride_id
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payment status
 */
app.get('/api/v1/payments/kashier/verify', authenticateToken, async (req, res) => {
  const { merchant_order_id, ride_id } = req.query;
  const rideId = ride_id || merchant_order_id;
  if (!rideId) return res.status(400).json({ error: 'معرف الرحلة مطلوب' });

  try {
    const ride = await prisma.rideRequest.findUnique({
      where: { id: rideId },
      select: { id: true, isPaid: true, paidAt: true, price: true, paymentMethod: true, driverId: true, status: true },
    });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });

    // استعلام Server-side من كاشير قبل تحديث قاعدة البيانات
    if (!ride.isPaid) {
      const remote = await queryKashierTransaction(rideId);
      if (remote?.paid) {
        if ((ride.paymentMethod || 'wallet') === 'card') {
          // بطاقة: سوّي مالياً بعد تأكيد كاشير
          await settleRide(null, { rideId, driverId: ride.driverId });
        } else {
          // محفظة: التسوية تمت عند الإكمال — أكّد الدفع فقط
          await prisma.rideRequest.update({ where: { id: rideId }, data: { isPaid: true, paidAt: new Date() } });
        }
        ride.isPaid = true;
      }
    }

    res.json({
      status: ride.isPaid ? 'success' : 'pending',
      rideId: ride.id,
      amount: ride.price,
      paidAt: ride.paidAt,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في التحقق من الدفع' });
  }
});

// ═══════════════════════════════════════════════════════
//  USER ENDPOINTS  /api/v1/user
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [User]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: User profile data
 */
app.get('/api/v1/user/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        phoneNumber: true,
        firstName: true,
        lastName: true,
        role: true,
        isVerified: true,
        avatarUrl: true,
        createdAt: true,
        driverProfile: true,
        wallet: { select: { balance: true } },
      },
    });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب البيانات' });
  }
});

/**
 * @swagger
 * /api/v1/user/profile/update:
 *   put:
 *     summary: Update user profile
 *     tags: [User]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               avatarUrl: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated
 */
app.put('/api/v1/user/profile/update', authenticateToken, async (req, res) => {
  const { firstName, lastName, avatarUrl } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(avatarUrl && { avatarUrl }),
      },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true },
    });
    res.json({ message: 'تم تحديث الملف الشخصي', user });
  } catch (error) {
    console.error('[updateProfile] IMAGE UPLOAD ERROR details:', error?.message || error);
    res.status(500).json({ error: 'خطأ في تحديث الملف الشخصي' });
  }
});

// ═══════════════════════════════════════════════════════
//  RATINGS ENDPOINTS
// ═══════════════════════════════════════════════════════

// NOTE: POST /api/v1/rate is handled via rateRideHandler (registered near line 161 through the rides flow).

/**
 * @swagger
 * /api/v1/user/ratings/{userId}:
 *   get:
 *     summary: Get user ratings
 *     tags: [Ratings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of ratings
 */
app.get('/api/v1/user/ratings/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  if (req.user.userId !== userId && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'غير مصرح لك برؤية هذه التقييمات' });
  }
  try {
    const ratings = await prisma.rating.findMany({
      where: { toUserId: userId },
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true, role: true } },
        ride: { select: { id: true, pickupPoint: true, dropoffPoint: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ratings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب التقييمات' });
  }
});

// ═══════════════════════════════════════════════════════
//  WEBHOOKS
// ═══════════════════════════════════════════════════════

/**
 * @swagger
 * /api/webhooks/kashier:
 *   post:
 *     summary: Kashier payment webhook
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Webhook processed
 */
app.post('/api/webhooks/kashier', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-kashier-signature'];
    if (!signature) return res.status(400).send('Missing signature');
    const payload = req.body.toString();

    console.log('[Webhook] Received payload (signature redacted)');

    if (!verifyWebhookSignature(payload, signature)) {
      console.error('[Webhook] ❌ Invalid signature');
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(payload);
    console.log('[Webhook] Verified event:', JSON.stringify({ status: event.status, orderId: event.orderId, amount: event.amount, sessionId: event.sessionId }));

    if (event.status !== 'PAID') return res.status(200).send('OK');

    // كاشير v3 بيرجّع sessionId (_id) في الـ webhook — نربطه بـ orderId عبر جدول paymentSession
    let orderId = event.orderId;
    if (!orderId && (event.sessionId || event._id)) {
      const stored = await prisma.paymentSession.findFirst({
        where: { sessionId: event.sessionId || event._id },
      });
      if (stored) orderId = stored.orderId;
    }
    if (!orderId) return res.status(200).send('OK');

    // شحن محفظة: orderId = topup_${userId}_${timestamp}
    if (orderId.startsWith('topup_')) {
      const userId = orderId.split('_')[1];
      const amount = parseFloat(event.amount);
      if (!userId || !amount || amount <= 0) return res.status(200).send('OK');

      // منع الاحتساب المكرر لنفس العملية (idempotent)
      const already = await prisma.walletTransaction.findFirst({
        where: { type: 'TOPUP', metadata: { path: ['orderId'], equals: orderId } },
      });
      if (already) {
        console.log(`[Webhook] ⏭️ Topup ${orderId} already credited`);
        return res.status(200).send('OK');
      }

      // عملية ذرية: تحديث الرصيد + تسجيل المعاملة في نفس transaction
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.upsert({
          where: { userId },
          update: { balance: { increment: amount } },
          create: { userId, balance: amount },
        });
        const txn = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'TOPUP',
            amount,
            balanceAfter: wallet.balance,
            description: 'شحن المحفظة عبر كاشير',
            status: 'COMPLETED',
            metadata: { orderId },
          },
        });
        // تحديث حالة جلسة الدفع
        await tx.paymentSession.updateMany({
          where: { orderId },
          data: { status: 'PAID', updatedAt: new Date() },
        });
        return { wallet, txn };
      });

      console.log(`[Webhook] ✅ Wallet topped up: user=${userId} amount=${amount} newBalance=${result.wallet.balance}`);
      return res.status(200).send('OK');
    }

    // دفع رحلة: orderId = rideId
    const ride = await prisma.rideRequest.findUnique({
      where: { id: orderId },
      select: { id: true, isPaid: true, paymentMethod: true, driverId: true },
    });
    if (!ride) return res.status(200).send('OK');
    if (ride.isPaid) return res.status(200).send('OK'); // تم التسوية مسبقاً (idempotent)

    if ((ride.paymentMethod || 'wallet') === 'card') {
      // الدفع ببطاقة: سوّي مالياً (أرباح الكابتن) بعد تأكيد كاشير فقط
      await settleRide(null, { rideId: orderId, driverId: ride.driverId });
    } else {
      // المحفظة: التسوية تمت عند إكمال الرحلة — نؤكّد الدفع فقط
      await prisma.rideRequest.update({ where: { id: orderId }, data: { isPaid: true, paidAt: new Date() } });
    }
    console.log(`[Webhook] ✅ Payment confirmed for ride ${orderId}`);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook] Error:', error);
    res.status(500).send('Internal error');
  }
});

// Payment callback page
app.get('/payment/callback', (req, res) => {
  const { status, orderId } = req.query;
  if (status === 'success') {
    res.send(`
      <h1 style="color:green;text-align:center;margin-top:50px;">✅ تم الدفع بنجاح</h1>
      <p style="text-align:center;">شكراً لك، سيتم تأكيد رحلتك (رقم ${orderId}).</p>
      <p style="text-align:center;"><a href="/">العودة للرئيسية</a></p>
    `);
  } else {
    res.send(`
      <h1 style="color:red;text-align:center;margin-top:50px;">❌ فشل الدفع</h1>
      <p style="text-align:center;">حدث خطأ، يرجى المحاولة مرة أخرى.</p>
      <p style="text-align:center;"><a href="/">العودة للرئيسية</a></p>
    `);
  }
});

// Legacy routes backward compatibility (redirect to v1)
app.post('/register-driver', (req, res) => res.redirect(307, '/api/v1/auth/register-driver'));
app.get('/me', (req, res) => res.redirect(307, '/api/v1/user/profile'));
app.post('/request-ride', (req, res) => res.redirect(307, '/api/v1/rides/request'));

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'Waslny API',
    version: '2.0.0',
    status: '🚀 يعمل بنجاح',
    docs: '/api-docs',
    timestamp: new Date().toISOString(),
  });
});

// ── Error Handlers ──────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Startup Validation: Kashier config ─────────────
// التحقق من وجود متغيّرات كاشير المطلوبة قبل تشغيل السيرفر
(function validateKashierConfig() {
  const required = ['KASHIER_API_KEY', 'KASHIER_SECRET_KEY', 'KASHIER_MID', 'APP_URL', 'KASHIER_MODE'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('❌ فشل التشغيل: متغيّرات بيئة كاشier ناقصة:');
    missing.forEach((k) => console.error(`   - ${k}`));
    console.error('يرجى تعيين هذه المتغيّرات في ملف .env قبل تشغيل السيرفر.');
    process.exit(1);
  }
})();

// ── Initialize Firebase (lazy on first use) ─────────
try {
  initFirebase();
} catch (error) {
  console.warn('⚠️  Firebase not initialized. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env');
}

// ── Start Server ────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Waslny API v2.0.0`);
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`📚 API Docs: http://0.0.0.0:${PORT}/api-docs`);
  console.log(`🔌 Socket.IO ready\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});
