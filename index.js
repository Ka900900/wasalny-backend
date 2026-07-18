require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const uploadRoutes = require('./src/routes/upload.routes');



const app = express();
const prisma = require('./src/config/prisma');
const JWT_SECRET = process.env.JWT_SECRET || "wasalny_secret";

app.use(cors());

// جعل express.json() شرطياً حتى لا يتعارض مع Multer في رفع الملفات
const jsonParser = express.json();
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  jsonParser(req, res, next);
});

// دالة حساب المسافة التقريبية (هافرسين)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// تحديد سعر الكيلومتر حسب وقت الذروة
function getPricePerKm() {
  const hour = new Date().getHours();
  const isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19);
  return isPeakHour ? 13 : 7;
}

// ميدلوير التحقق من التوكن
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'لم يتم توفير توكن' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'توكن غير صالح' });
    req.user = user;
    next();
  });
};

// ============================
// المسارات الأساسية
// ============================
app.get('/', (req, res) => {
  res.send('🚀 خادم وصلني يعمل بنجاح');
});

// رفع الصور إلى Cloudinary
app.use('/api/v1/upload', uploadRoutes);

// 1. تسجيل/دخول - إرسال OTP (محسّن للأداء)
app.post('/register', async (req, res) => {
  const { phoneNumber, firstName, lastName } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'رقم الهاتف مطلوب' });

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60000);

  try {
    // البحث عن المستخدم أولاً (أسرع من upsert في SQLite)
    let user = await prisma.user.findUnique({ where: { phoneNumber } });

    if (user) {
      user = await prisma.user.update({
        where: { phoneNumber },
        data: { otpCode: otp, otpExpiresAt: expiresAt, isVerified: false },
      });
    } else {
      user = await prisma.user.create({
        data: {
          phoneNumber,
          firstName: firstName || 'مستخدم',
          lastName: lastName || 'جديد',
          otpCode: otp,
          otpExpiresAt: expiresAt,
        },
      });
    }

    console.log(`OTP for ${phoneNumber}: ${otp}`);
    res.json({ message: 'تم إرسال الكود' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في السيرفر' });
  }
});

// 2. التحقق من OTP وإصدار التوكن
app.post('/verify-otp', async (req, res) => {
  const { phoneNumber, otp } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { phoneNumber } });
    if (!user || !user.otpExpiresAt || user.otpCode !== otp || new Date() > user.otpExpiresAt) {
      return res.status(400).json({ error: 'كود غير صحيح' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true, otpCode: null, otpExpiresAt: null },
    });
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ message: 'تم التحقق', token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في التحقق' });
  }
});

// 3. تسجيل كابتن
app.post('/register-driver', authenticateToken, async (req, res) => {
  if (req.user.role === 'DRIVER') {
    return res.status(400).json({ error: 'أنت بالفعل مسجل ككابتن' });
  }
  const { carModel, carPlateNumber, carColor } = req.body;
  if (!carModel || !carPlateNumber || !carColor) {
    return res.status(400).json({ error: 'بيانات السيارة مطلوبة (الموديل، اللوحة، اللون)' });
  }
  try {
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: req.user.userId,
        carModel,
        carPlateNumber,
        carColor,
      },
    });
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { role: 'DRIVER' },
    });
    res.status(201).json({ message: 'تم التسجيل ككابتن بنجاح', driverProfile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'حدث خطأ أثناء التسجيل ككابتن' });
  }
});

// 4. تحديث موقع الكابتن
app.put('/driver/location', authenticateToken, async (req, res) => {
  if (req.user.role !== 'DRIVER') {
    return res.status(403).json({ error: 'غير مصرح به، هذا المسار مخصص للكباتن فقط' });
  }
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'يجب إرسال lat و lng' });
  }
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ error: 'الإحداثيات غير صحيحة' });
  }
  try {
    const updatedProfile = await prisma.driverProfile.update({
      where: { userId: req.user.userId },
      data: { currentLat: latitude, currentLng: longitude },
    });
    res.json({ message: 'تم تحديث الموقع بنجاح', driverProfile: updatedProfile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث الموقع' });
  }
});

// 5. جلب الرحلات القريبة للكابتن
app.get('/available-rides', authenticateToken, async (req, res) => {
  if (req.user.role !== 'DRIVER') {
    return res.status(403).json({ error: 'غير مصرح به، هذا المسار مخصص للكباتن فقط' });
  }
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: req.user.userId },
  });
  if (!driverProfile || driverProfile.currentLat === null || driverProfile.currentLng === null) {
    return res.status(400).json({ error: 'موقع الكابتن غير محدد. يرجى تحديث موقعك أولاً.' });
  }
  const driverLat = driverProfile.currentLat;
  const driverLng = driverProfile.currentLng;
  const SEARCH_RADIUS_KM = parseFloat(process.env.SEARCH_RADIUS_KM) || 5;
  const pendingRides = await prisma.rideRequest.findMany({
    where: { status: 'PENDING' },
    include: { rider: true },
  });
  if (pendingRides.length === 0) {
    return res.json({ message: 'لا توجد رحلات متاحة حالياً', rides: [] });
  }
  const ridesWithDistance = pendingRides
    .map(ride => ({
      ...ride,
      distance: haversineDistance(driverLat, driverLng, ride.originLat, ride.originLng)
    }))
    .filter(ride => ride.distance <= SEARCH_RADIUS_KM)
    .sort((a, b) => a.distance - b.distance);
  if (ridesWithDistance.length === 0) {
    return res.json({ message: `لا توجد رحلات ضمن نطاق ${SEARCH_RADIUS_KM} كم`, rides: [] });
  }
  res.json({
    message: `تم العثور على ${ridesWithDistance.length} رحلة قريبة`,
    driverLocation: { lat: driverLat, lng: driverLng },
    searchRadiusKm: SEARCH_RADIUS_KM,
    rides: ridesWithDistance,
  });
});

// 6. قبول الرحلة
app.post('/accept-ride/:rideId', authenticateToken, async (req, res) => {
  if (req.user.role !== 'DRIVER') {
    return res.status(403).json({ error: 'غير مصرح، هذا المسار للكباتن فقط' });
  }
  const { rideId } = req.params;
  try {
    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.status !== 'PENDING') return res.status(400).json({ error: 'الرحلة لم تعد متاحة' });
    const updatedRide = await prisma.rideRequest.update({
      where: { id: rideId },
      data: { driverId: req.user.userId, status: 'ACCEPTED' }
    });
    res.json({ message: 'تم قبول الرحلة بنجاح', ride: updatedRide });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'حدث خطأ أثناء قبول الرحلة' });
  }
});

// 7. بدء الرحلة
app.put('/ride/start/:rideId', authenticateToken, async (req, res) => {
  if (req.user.role !== 'DRIVER') {
    return res.status(403).json({ error: 'غير مصرح، هذا المسار للكباتن فقط' });
  }
  const { rideId } = req.params;
  try {
    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.driverId !== req.user.userId) return res.status(403).json({ error: 'هذه الرحلة ليست مخصصة لك' });
    if (ride.status !== 'ACCEPTED') return res.status(400).json({ error: 'لا يمكن بدء رحلة إلا بعد قبولها' });
    const updated = await prisma.rideRequest.update({
      where: { id: rideId },
      data: { status: 'STARTED' }
    });
    res.json({ message: 'تم بدء الرحلة', ride: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في بدء الرحلة' });
  }
});

// 8. إنهاء الرحلة
app.put('/ride/complete/:rideId', authenticateToken, async (req, res) => {
  if (req.user.role !== 'DRIVER') {
    return res.status(403).json({ error: 'غير مصرح، هذا المسار للكباتن فقط' });
  }
  const { rideId } = req.params;
  try {
    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.driverId !== req.user.userId) return res.status(403).json({ error: 'هذه الرحلة ليست مخصصة لك' });
    if (ride.status !== 'STARTED') return res.status(400).json({ error: 'لا يمكن إنهاء رحلة لم تبدأ بعد' });
    const updated = await prisma.rideRequest.update({
      where: { id: rideId },
      data: { status: 'COMPLETED' }
    });
    res.json({ message: 'تم إنهاء الرحلة', ride: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في إنهاء الرحلة' });
  }
});

// 9. إلغاء الرحلة
app.put('/ride/cancel/:rideId', authenticateToken, async (req, res) => {
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
      data: { status: 'CANCELLED' }
    });
    res.json({ message: 'تم إلغاء الرحلة', ride: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في إلغاء الرحلة' });
  }
});

// 10. جلب بيانات المستخدم
app.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, phoneNumber: true, firstName: true, lastName: true, role: true, isVerified: true }
    });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب البيانات' });
  }
});

// 11. طلب رحلة (مع حساب سعر ديناميكي وعمولة)
app.post('/request-ride', authenticateToken, async (req, res) => {
  const { pickupPoint, dropoffPoint, originLat, originLng, destLat, destLng } = req.body;
  if (!originLat || !originLng || !destLat || !destLng) {
    return res.status(400).json({ error: 'الإحداثيات مطلوبة' });
  }
  const lat1 = parseFloat(originLat);
  const lng1 = parseFloat(originLng);
  const lat2 = parseFloat(destLat);
  const lng2 = parseFloat(destLng);
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
    return res.status(400).json({ error: 'إحداثيات غير صحيحة' });
  }
  try {
    let distanceInKm;
    if (process.env.ORS_API_KEY) {
      const orsUrl = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
      const response = await axios.post(orsUrl, {
        coordinates: [[lng1, lat1], [lng2, lat2]]
      }, {
        headers: {
          'Authorization': process.env.ORS_API_KEY,
          'Content-Type': 'application/json'
        }
      });
      distanceInKm = response.data.features[0].properties.segments[0].distance / 1000;
    } else {
      distanceInKm = haversineDistance(lat1, lng1, lat2, lng2);
    }
    const pricePerKm = getPricePerKm();
    const calculatedPrice = parseFloat((distanceInKm * pricePerKm).toFixed(2));
    const commissionPercent = parseFloat(process.env.COMMISSION_PERCENTAGE) || 0;
    const commission = (calculatedPrice * commissionPercent) / 100;
    const driverEarning = calculatedPrice - commission;
    const newRide = await prisma.rideRequest.create({
      data: {
        riderId: req.user.userId,
        pickupPoint: pickupPoint || '',
        dropoffPoint: dropoffPoint || '',
        originLat: lat1,
        originLng: lng1,
        destLat: lat2,
        destLng: lng2,
        price: calculatedPrice,
        distance: distanceInKm,
      },
    });
    res.status(201).json({
      message: 'تم طلب الرحلة بنجاح!',
      ride: newRide,
      distance: distanceInKm,
      price: calculatedPrice,
      pricePerKm,
      commission: parseFloat(commission.toFixed(2)),
      driverEarning: parseFloat(driverEarning.toFixed(2)),
    });
  } catch (error) {
    console.error("خطأ:", error.response?.data || error.message);
    const fallbackDistance = haversineDistance(lat1, lng1, lat2, lng2);
    const pricePerKm = getPricePerKm();
    const fallbackPrice = parseFloat((fallbackDistance * pricePerKm).toFixed(2));
    const commissionPercent = parseFloat(process.env.COMMISSION_PERCENTAGE) || 0;
    const fallbackCommission = (fallbackPrice * commissionPercent) / 100;
    const fallbackDriverEarning = fallbackPrice - fallbackCommission;
    try {
      const newRide = await prisma.rideRequest.create({
        data: {
          riderId: req.user.userId,
          pickupPoint: pickupPoint || '',
          dropoffPoint: dropoffPoint || '',
          originLat: lat1,
          originLng: lng1,
          destLat: lat2,
          destLng: lng2,
          price: fallbackPrice,
          distance: fallbackDistance,
        },
      });
      res.status(201).json({
        message: 'تم طلب الرحلة (تقديري)',
        ride: newRide,
        distance: fallbackDistance,
        price: fallbackPrice,
        pricePerKm,
        commission: parseFloat(fallbackCommission.toFixed(2)),
        driverEarning: parseFloat(fallbackDriverEarning.toFixed(2)),
        note: 'تم حساب المسافة تقريبياً بسبب خطأ في خدمة الخرائط'
      });
    } catch (dbError) {
      res.status(500).json({ error: 'حدث خطأ أثناء حفظ الرحلة' });
    }
  }
});

// 12. تقييم مستخدم
app.post('/rate', authenticateToken, async (req, res) => {
  const { rideId, toUserId, rating, comment } = req.body;
  if (!rideId || !toUserId || !rating) return res.status(400).json({ error: 'معرف الرحلة، معرف المستخدم المراد تقييمه، والتقييم مطلوبة' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و 5' });
  try {
    const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.status !== 'COMPLETED') return res.status(400).json({ error: 'لا يمكن تقييم إلا بعد انتهاء الرحلة' });
    const isRider = (ride.riderId === req.user.userId);
    const isDriver = (ride.driverId === req.user.userId);
    if (!isRider && !isDriver) return res.status(403).json({ error: 'غير مصرح: أنت لست طرفاً في هذه الرحلة' });
    const otherId = isRider ? ride.driverId : ride.riderId;
    if (toUserId !== otherId) return res.status(400).json({ error: 'يمكنك فقط تقييم الطرف الآخر في الرحلة' });
    const existingRating = await prisma.rating.findUnique({ where: { rideId } });
    if (existingRating) return res.status(400). json({ error: 'تم تقييم هذه الرحلة بالفعل' });
    const newRating = await prisma.rating.create({
      data: { rideId, fromUserId: req.user.userId, toUserId, rating, comment: comment || null },
    });
    if (ride.driverId === toUserId) {
      const avg = await prisma.rating.aggregate({ where: { toUserId }, _avg: { rating: true } });
      await prisma.driverProfile.update({
        where: { userId: toUserId },
        data: { ratingAvg: avg._avg.rating || 0 },
      });
    }
    res.status(201).json({ message: 'تم إضافة التقييم', rating: newRating });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ أثناء إضافة التقييم' });
  }
});

// 13. جلب تقييمات مستخدم
app.get('/ratings/user/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  if (req.user.userId !== userId && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'غير مصرح لك برؤية هذه التقييمات' });
  }
  try {
    const ratings = await prisma.rating.findMany({
      where: { toUserId: userId },
      include: {
        fromUser: { select: { id: true, firstName: true, lastName: true, role: true } },
        ride: { select: { id: true, pickupPoint: true, dropoffPoint: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(ratings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب التقييمات' });
  }
});

// ============================
// بوابات الدفع (Kashier)
// ============================
// إنشاء جلسة دفع (تستقبل rideId في body)
app.post('/create-payment', authenticateToken, async (req, res) => {
  const { rideId } = req.body;
  if (!rideId) return res.status(400).json({ error: 'معرف الرحلة مطلوب' });
  try {
    const ride = await prisma.rideRequest.findUnique({
      where: { id: rideId },
      include: { rider: true }
    });
    if (!ride) return res.status(404).json({ error: 'الرحلة غير موجودة' });
    if (ride.riderId !== req.user.userId)
      return res.status(403).json({ error: 'غير مصرح لك بدفع ثمن هذه الرحلة' });
    // إذا كان لديك حقل isPaid فتأكد منه، وإلا يمكن تخطي هذا التحقق
    if (ride.isPaid) return res.status(400).json({ error: 'هذه الرحلة مدفوعة مسبقاً' });

    const session = await createKashierSession(
      rideId,
      ride.price,
      `${ride.rider.firstName} ${ride.rider.lastName}`,
      ride.rider.phoneNumber,
      `دفع تكلفة الرحلة رقم ${rideId}`
    );
    res.json({
      message: 'تم إنشاء رابط الدفع بنجاح',
      paymentUrl: session.paymentUrl,
      sessionId: session.orderId,
    });
  } catch (error) {
    console.error('خطأ في إنشاء جلسة دفع:', error.response?.data || error.message);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء جلسة الدفع' });
  }
});

// Webhook لاستقبال إشعارات الدفع (يجب أن يكون raw body)
app.post('/api/webhooks/kashier', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-kashier-signature'];
    if (!signature) return res.status(400).send('Missing signature');
    const payload = req.body.toString();
    const expectedSignature = crypto
      .createHmac('sha256', KASHIER_SECRET_KEY)
      .update(payload)
      .digest('hex');
    if (signature !== expectedSignature) {
      console.error('توقيع غير صالح');
      return res.status(401).send('Invalid signature');
    }
    const event = JSON.parse(payload);
    if (event.status === 'PAID') {
      const rideId = event.orderId;
      // تحديث الرحلة: تأكد من وجود حقلي isPaid و paidAt في schema.prisma
      await prisma.rideRequest.update({
        where: { id: rideId },
        data: { isPaid: true, paidAt: new Date() }
      });
      console.log(`✅ تم تأكيد دفع الرحلة ${rideId}`);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('خطأ في معالجة webhook:', error);
    res.status(500).send('Internal error');
  }
});

// صفحة رد بعد الدفع (اختيارية)
app.get('/payment/callback', (req, res) => {
  const { status, orderId } = req.query;
  if (status === 'success') {
    res.send(`
      <h1 style="color:green;">✅ تم الدفع بنجاح</h1>
      <p>شكرًا لك، سيتم تأكيد رحلتك (رقم ${orderId}).</p>
      <a href="/">العودة للرئيسية</a>
    `);
  } else {
    res.send(`
      <h1 style="color:red;">❌ فشل الدفع</h1>
      <p>حدث خطأ، يرجى المحاولة مرة أخرى.</p>
      <a href="/">العودة للرئيسية</a>
    `);
  }
});

// ============================
// تشغيل الخادم
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ السيرفر يعمل على http://0.0.0.0:${PORT}`));