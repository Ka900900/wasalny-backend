const { updateLocation, getAvailableRides, acceptRide, startRide, completeRide } = require('../services/captain.service');
const userRepository = require('../repositories/user.repository');
const { emitRideStatus, emitDriverLocation, SocketEvents } = require('../config/socket');
const prisma = require('../config/prisma');
const { uploadToCloudinary } = require('../services/upload.service'); // تأكد إن المسار صح

async function updateLocationHandler(req, res, io) {
  try {
    const updatedProfile = await updateLocation(req.user.userId, req.body.lat, req.body.lng);

    const activeRides = await prisma.rideRequest.findMany({
      where: { driverId: req.user.userId, status: { in: ['ACCEPTED', 'STARTED'] } },
      select: { id: true },
    });

    for (const ride of activeRides) {
      emitDriverLocation(io, ride.id, req.body.lat, req.body.lng, null);
    }

    res.json({ message: 'تم تحديث الموقع', driverProfile: updatedProfile });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'حدث خطأ أثناء تحديث الموقع' });
  }
}

async function getAvailableRidesHandler(req, res) {
  try {
    const data = await getAvailableRides(req.user.userId, parseFloat(process.env.SEARCH_RADIUS_KM) || 5);
    res.json({ message: `تم العثور على ${data.rides.length} رحلة قريبة`, driverLocation: data.driverLocation, searchRadiusKm: data.searchRadiusKm, rides: data.rides });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في جلب الرحلات المتاحة' });
  }
}

async function toggleAvailabilityHandler(req, res, io) {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ error: 'isAvailable must be a boolean' });
    }

    const updatedProfile = await userRepository.setDriverAvailability(req.user.userId, isAvailable);
    const eventName = isAvailable ? SocketEvents.DRIVER_ONLINE : SocketEvents.DRIVER_OFFLINE;
    const payload = {
      driverId: req.user.userId,
      isAvailable,
      _timestamp: new Date().toISOString(),
    };

    io.to('drivers').emit(eventName, payload);
    io.to('riders').emit(eventName, payload);

    res.json({
      message: `تم تغيير حالة التوفر إلى ${isAvailable ? 'متاح' : 'غير متاح'}`,
      driverProfile: updatedProfile,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'حدث خطأ أثناء تغيير حالة التوفر' });
  }
}

async function acceptRideHandler(req, res, io) {
  try {
    const updatedRide = await acceptRide(req.user.userId, req.params.rideId);
    emitRideStatus(io, req.params.rideId, 'ACCEPTED', {
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
    res.status(400).json({ error: error.message || 'حدث خطأ أثناء قبول الرحلة' });
  }
}

async function startRideHandler(req, res, io) {
  try {
    const updated = await startRide(req.user.userId, req.params.rideId);
    emitRideStatus(io, req.params.rideId, 'STARTED');
    res.json({ message: 'تم بدء الرحلة', ride: updated });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في بدء الرحلة' });
  }
}

async function completeRideHandler(req, res, io) {
  try {
    const { updatedRide } = await completeRide(req.user.userId, req.params.rideId);
    emitRideStatus(io, req.params.rideId, 'COMPLETED');
    res.json({ message: 'تم إنهاء الرحلة', ride: updatedRide });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في إنهاء الرحلة' });
  }
}

// ── Helpers ──────────────────────────────────────────
// يحوّل Prisma.Decimal / Float / String لـ Number عادي (JSON آمن)
function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toNumber === 'function') return v.toNumber(); // Prisma.Decimal
  return Number(v);
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// بيبني الفترات (buckets) بناءً على الـ period المطلوب
function buildPeriodBuckets(period, now = new Date()) {
  const buckets = [];

  if (period === 'weekly') {
    // آخر 8 أسابيع (الأسبوع يبدأ الإثنين)
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      const day = d.getDay(); // 0=Sun .. 6=Sat
      const diffToMonday = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diffToMonday - i * 7);
      d.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      buckets.push({ start: d, end, label: `أسبوع ${8 - i}`, amount: 0, tripCount: 0, distanceKm: 0 });
    }
  } else if (period === 'monthly') {
    // آخر 12 شهر
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      buckets.push({ start: d, end, label: AR_MONTHS[d.getMonth()], amount: 0, tripCount: 0, distanceKm: 0 });
    }
  } else {
    // daily (افتراضي) — آخر 7 أيام
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      buckets.push({ start: d, end, label: AR_DAYS[d.getDay()], amount: 0, tripCount: 0, distanceKm: 0 });
    }
  }
  return buckets;
}

// ── Handler ──────────────────────────────────────────
async function getEarningsHandler(req, res) {
  try {
    const allowed = ['daily', 'weekly', 'monthly'];
    const period = allowed.includes(req.query.period) ? req.query.period : 'daily';

    const buckets = buildPeriodBuckets(period);
    const fromDate = buckets[0].start;

    // نجيب الرحلات المكتملة للكابتن، مع أعمدة مختارة بس (أخف في الذاكرة)
    const rides = await prisma.rideRequest.findMany({
      where: {
        driverId: req.user.userId,
        status: 'COMPLETED',
        createdAt: { gte: fromDate },
      },
      select: { driverEarning: true, distance: true, createdAt: true },
    });

    // نوزّع كل رحلة على الفترة بتاعتها
    for (const ride of rides) {
      const b = buckets.find((x) => ride.createdAt >= x.start && ride.createdAt <= x.end);
      if (!b) continue;
      b.amount += toNum(ride.driverEarning);
      b.distanceKm += toNum(ride.distance);
      b.tripCount += 1;
    }

    // الإجماليات على مستوى الاستجابة كلها
    const totalAmount = buckets.reduce((s, b) => s + b.amount, 0);
    const totalTrips = buckets.reduce((s, b) => s + b.tripCount, 0);
    const totalDistanceKm = buckets.reduce((s, b) => s + b.distanceKm, 0);
    const averagePerTrip = totalTrips > 0 ? totalAmount / totalTrips : 0;

    // لو مفيش رحلات → كل القيم صفر (مفيش بيانات وهمية)
    res.json({
      totalAmount: round2(totalAmount),
      totalTrips,
      totalDistanceKm: round2(totalDistanceKm),
      averagePerTrip: round2(averagePerTrip),
      periods: buckets.map((b) => ({
        label: b.label,
        amount: round2(b.amount),
        tripCount: b.tripCount,
        distanceKm: round2(b.distanceKm),
      })),
    });
  } catch (error) {
    // نطبع الخطأ الحقيقي بالتفصيل في الـ Console للتتبع أثناء التجربة الميدانية
    console.error('❌ getEarningsHandler error:', error);
    // نرجّع نص الخطأ الحقيقي للواجهة عشان المختبرين يقدروا يتبعوا الخلل
    res.status(500).json({
      error: 'خطأ في جلب الأرباح',
      details: error?.message || String(error),
    });
  }
}

// ── Driver Ratings ──────────────────────────────────
async function getDriverRatingsHandler(req, res) {
  try {
    const driverId = req.user.userId;

    // تجميع مباشر (live) → متوسط دقيق + عدد كلي في query واحد
    const agg = await prisma.rating.aggregate({
      where: { toUserId: driverId },
      _count: { _all: true },
      _avg: { rating: true },
    });
    const totalRatings = agg._count._all;
    const averageRating = totalRatings > 0 ? toNum(agg._avg.rating) : 0;

    // قائمة التقييمات مع بيانات الراكب والرحلة
    const ratings = await prisma.rating.findMany({
      where: { toUserId: driverId },
      include: {
        fromUser: { select: { firstName: true, lastName: true } },
        ride: { select: { pickupAddress: true, pickupPoint: true, destinationAddress: true, dropoffPoint: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const ratingsView = ratings.map((r) => ({
      id: r.id,
      rating: toNum(r.rating),
      comment: r.comment || null,
      createdAt: r.createdAt.toISOString(),           // Date → ISO string (JSON-safe)
      fromUserName: `${r.fromUser?.firstName || ''} ${r.fromUser?.lastName || ''}`.trim() || 'مستخدم',
      // نستخدم العنوان النصي، مع fallback للـ Point لو العنوان فاضي (بيانات قديمة)
      rideRoute: r.ride
        ? `من ${r.ride.pickupAddress || r.ride.pickupPoint} إلى ${r.ride.destinationAddress || r.ride.dropoffPoint}`
        : '',
    }));

    // لو مفيش تقييمات → averageRating=0, totalRatings=0, ratings=[]
    res.json({
      averageRating: round2(averageRating),
      totalRatings,
      ratings: ratingsView,
    });
  } catch (error) {
    // نطبع الخطأ الحقيقي بالتفصيل في الـ Console للتتبع أثناء التجربة الميدانية
    console.error('❌ getDriverRatingsHandler error:', error);
    // نرجّع نص الخطأ الحقيقي للواجهة عشان المختبرين يقدروا يتبعوا الخلل
    res.status(500).json({
      error: 'خطأ في جلب التقييمات',
      details: error?.message || String(error),
    });
  }
}
// ── Upload Documents ────────────────────────────────
async function uploadDocuments(req, res) {
  try {
    const userId = req.user.userId; 
    const files = req.files;

    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إرفاق المستندات المطلوبة',
      });
    }

    const uploadedUrls = {};

    // رفع الملفات لـ Cloudinary
    for (const fieldName of Object.keys(files)) {
      const file = files[fieldName][0];
      const result = await uploadToCloudinary(file.buffer, `waslny/captains/${userId}`);
      uploadedUrls[fieldName] = result.secure_url;
    }

    // تحديث صورة الكابتن في الداتا بيز (وتقدر تضيف أي حقول تانية للبطاقة والرخصة لو موجودة في Prisma)
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(uploadedUrls.avatar && { avatarUrl: uploadedUrls.avatar }),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'تم رفع المستندات بنجاح',
      documents: uploadedUrls,
      user: updatedUser,
    });
  } catch (error) {
    console.error('❌ Error uploading documents:', error);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء رفع المستندات',
      details: error.message || String(error),
    });
  }
}
// ── Add Vehicle ──────────────────────────────────────
async function addVehicleHandler(req, res) {
  try {
    const userId = req.user.userId;

    // ── Validation ──────────────────────────────────
    const { make, model, year, color, plateNumber, vehicleType } = req.body;

    if (!make || !model || !year || !color || !plateNumber || !vehicleType) {
      return res.status(400).json({
        success: false,
        message: 'جميع الحقول مطلوبة: make, model, year, color, plateNumber, vehicleType',
      });
    }

    const files = req.files;
    if (!files || !files.licenseFront || !files.licenseBack) {
      return res.status(400).json({
        success: false,
        message: 'يرجى رفع صورتين: licenseFront و licenseBack',
      });
    }

    // ── Upload to Cloudinary ────────────────────────
    const frontFile = files.licenseFront[0];
    const backFile = files.licenseBack[0];

    const [frontResult, backResult] = await Promise.all([
      uploadToCloudinary(frontFile.buffer, 'waslny/vehicles'),
      uploadToCloudinary(backFile.buffer, 'waslny/vehicles'),
    ]);

    // ── Upsert Vehicle ──────────────────────────────
    const vehicle = await prisma.vehicle.upsert({
      where: { plateNumber },
      update: {
        make,
        model,
        year: parseInt(year, 10),
        color,
        vehicleType: vehicleType.toUpperCase(),
        licenseFrontUrl: frontResult.secure_url,
        licenseBackUrl: backResult.secure_url,
      },
      create: {
        userId,
        make,
        model,
        year: parseInt(year, 10),
        color,
        plateNumber,
        vehicleType: vehicleType.toUpperCase(),
        licenseFrontUrl: frontResult.secure_url,
        licenseBackUrl: backResult.secure_url,
      },
    });

    // ── تحديث/إنشاء DriverProfile ببيانات المركبة الحقيقية ──
    await prisma.driverProfile.upsert({
      where: { userId },
      update: {
        carModel: `${make} ${model}`,
        carColor: color,
        carPlateNumber: plateNumber,
        vehicleType: vehicleType.toUpperCase(),
        carPhotoUrl: frontResult.secure_url,
      },
      create: {
        userId,
        carModel: `${make} ${model}`,
        carColor: color,
        carPlateNumber: plateNumber,
        vehicleType: vehicleType.toUpperCase(),
        carPhotoUrl: frontResult.secure_url,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'تم إضافة المركبة بنجاح',
      vehicle,
    });
  } catch (error) {
    // Handle duplicate plate number
    if (error.code === 'P2002' && error.meta?.target?.includes('plateNumber')) {
      return res.status(400).json({
        success: false,
        message: 'رقم اللوحة هذا مسجل بالفعل لمركبة أخرى',
      });
    }

    console.error('❌ addVehicleHandler error:', error);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء إضافة المركبة',
      details: error.message || String(error),
    });
  }
}

module.exports = { 
  updateLocationHandler, 
  getAvailableRidesHandler, 
  toggleAvailabilityHandler, 
  acceptRideHandler, 
  startRideHandler, 
  completeRideHandler, 
  getEarningsHandler, 
  getDriverRatingsHandler,
  uploadDocuments, // 👈 ضفنا دالة الرفع هنا
  addVehicleHandler, // 👈 دالة إضافة المركبة
};