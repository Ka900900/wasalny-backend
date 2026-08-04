const prisma = require('../config/prisma');
const { getFirestore } = require('../config/firebase');
const { calculateDistance, estimateDuration, calculateFare, haversineDistance, getPricePerKm, isPeakHourNow } = require('./geo');
const { emitRideStatus, SocketEvents } = require('../config/socket');
const { Prisma } = require('@prisma/client');
const { notifyCaptainsNewRide } = require('./fcm.service');
const userRepository = require('../repositories/user.repository');
const { getWalletLimit, DEFAULT_LIMITS, assertCanAcceptRides } = require('../config/wallet.constants');
const { getRidePolicyConfig } = require('../config/ride.policy');
const { createAdminNotification } = require('./notification.service');

// ── نظام العمولة مع دعم عرض الكباتن الأوائل (قابل للتعديل من Config) ──
let _configCache = null;
let _configCacheAt = 0;

async function _getConfig(key, defaultValue) {
  const now = Date.now();
  if (_configCache === null || now - _configCacheAt > 5 * 60 * 1000) {
    const keys = ['COMMISSION_RATE', 'PROMO_COMMISSION_RATE', 'PROMO_CAPTAINS_LIMIT', 'PROMO_MAX_RIDES', 'PROMO_DAYS_LIMIT'];
    const rows = await prisma.config.findMany({
      where: { key: { in: keys } },
    });
    _configCache = {};
    for (const row of rows) {
      _configCache[row.key] = row.valueType === 'NUMBER' ? parseFloat(row.value) : row.value;
    }
    _configCacheAt = now;
  }
  return _configCache[key] !== undefined ? _configCache[key] : defaultValue;
}

async function getCommissionRate(driverId) {
  const baseRate = await _getConfig('COMMISSION_RATE', 0.10);

  // بدون driverId (مثلاً عند حساب السعر قبل التعيين) → العمولة الأساسية
  if (!driverId) return baseRate;

  const promoRate = await _getConfig('PROMO_COMMISSION_RATE', 0.05);
  const captainsLimit = await _getConfig('PROMO_CAPTAINS_LIMIT', 100);
  const maxRides = await _getConfig('PROMO_MAX_RIDES', 50);
  const daysLimit = await _getConfig('PROMO_DAYS_LIMIT', 30);

  // التحقق من أن driverId هو كابتن فعلاً
  const captain = await prisma.user.findUnique({
    where: { id: driverId },
    select: { createdAt: true, role: true },
  });
  if (!captain || captain.role !== 'CAPTAIN') return baseRate;

  // الشرط 1: عدد الكباتن الذين سجلوا قبل هذا الكابتن < الحد المسموح
  const earlierCount = await prisma.user.count({
    where: { role: 'CAPTAIN', createdAt: { lt: captain.createdAt } },
  });
  if (earlierCount >= captainsLimit) return baseRate;

  // الشرط 2: عدد الرحلات المكتملة لهذا الكابتن < الحد المسموح
  const completedRides = await prisma.rideRequest.count({
    where: { driverId, status: 'COMPLETED' },
  });
  if (completedRides >= maxRides) return baseRate;

  // الشرط 3: لم يمضِ على تسجيله أكثر من daysLimit يوماً
  const daysSince = (Date.now() - captain.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince >= daysLimit) return baseRate;

  // جميع الشروط مستوفاة → العمولة التشجيعية
  return promoRate;
}

/**
 * إبطال ذاكرة إعدادات الـ Config مؤقتاً.
 * تُستدعى بعد تعديل نسبة العمولة من لوحة التحكم حتى يُطبَّق التغيير فوراً
 * (بدلاً من انتظار انتهاء مدة الكاش 5 دقائق).
 */
function resetConfigCache() {
  _configCache = null;
  _configCacheAt = 0;
}

const CAR_NAMES = ['economy', 'comfort', 'premium', 'xl'];
const CAR_DEFAULTS = [
  { name: 'economy', nameAr: 'اقتصادي', description: 'Cheapest option', descriptionAr: 'الخيار الأرخص', icon: 'economy', capacity: 4, baseFare: 10, pricePerKm: 4, pricePerMinute: 0.75, multiplier: 1.0 },
  { name: 'comfort', nameAr: 'مريح', description: 'Comfortable ride', descriptionAr: 'رحلة مريحة', icon: 'comfort', capacity: 4, baseFare: 15, pricePerKm: 6, pricePerMinute: 1.0, multiplier: 1.0 },
  { name: 'premium', nameAr: 'ممتاز', description: 'Luxury vehicles', descriptionAr: 'سيارات فاخرة', icon: 'premium', capacity: 4, baseFare: 25, pricePerKm: 10, pricePerMinute: 1.5, multiplier: 1.5 },
  { name: 'xl', nameAr: 'عائلي', description: 'Family vehicles', descriptionAr: 'سيارات عائلية', icon: 'xl', capacity: 6, baseFare: 20, pricePerKm: 8, pricePerMinute: 1.25, multiplier: 1.2 },
];
const MOTORCYCLE_DEFAULT = { name: 'motorcycle', nameAr: 'موتوسيكل', description: 'Motorcycle ride', descriptionAr: 'رحلة موتوسيكل', icon: 'motorcycle', capacity: 2, baseFare: 6, pricePerKm: 2.5, pricePerMinute: 0.375, multiplier: 1.0 };
const SCOOTER_DEFAULT = { name: 'scooter', nameAr: 'سكوتر', description: 'Scooter ride', descriptionAr: 'رحلة سكوتر', icon: 'scooter', capacity: 1, baseFare: 5, pricePerKm: 2, pricePerMinute: 0.25, multiplier: 1.0 };

async function getRideOptions() {
  let allOptions = await prisma.rideOption.findMany({ where: { isActive: true }, orderBy: { pricePerKm: 'asc' } });

  // Seed defaults if nothing exists in DB
  if (allOptions.length === 0) {
    for (const opt of [...CAR_DEFAULTS, MOTORCYCLE_DEFAULT, SCOOTER_DEFAULT]) {
      await prisma.rideOption.create({ data: { ...opt, isActive: true } });
    }
    allOptions = await prisma.rideOption.findMany({ where: { isActive: true } });
  }

  const carOptions = allOptions.filter(o => CAR_NAMES.includes(o.name));
  const motorcycleOption = allOptions.find(o => o.name === 'motorcycle') || null;
  const scooterOption = allOptions.find(o => o.name === 'scooter') || null;

  return { carOptions, motorcycleOption, scooterOption };
}

async function calculateRideFare({ originLat, originLng, destLat, destLng, rideType }) {
  const distanceKm = await calculateDistance(originLat, originLng, destLat, destLng);
  const durationMin = estimateDuration(distanceKm, 25);

  let multiplier = 1.0;
  let rideOption = null;
  if (rideType) {
    rideOption = await prisma.rideOption.findFirst({
      where: { OR: [{ id: rideType }, { name: rideType }], isActive: true },
    });
    if (rideOption) multiplier = parseFloat(rideOption.multiplier.toString());
  }

  const commissionRate = await getCommissionRate();
  const base = calculateFare({
    distanceKm,
    durationMinutes: durationMin,
    baseFare: rideOption?.baseFare ? parseFloat(rideOption.baseFare.toString()) : 0,
    pricePerKm: getPricePerKm(rideType),
    pricePerMinute: rideOption?.pricePerMinute ? parseFloat(rideOption.pricePerMinute.toString()) : 0,
    commissionRate,
  });
  const finalPrice = parseFloat((base.price * multiplier).toFixed(2));
  const commission = parseFloat((finalPrice * commissionRate).toFixed(2));

  return {
    distance: parseFloat(distanceKm.toFixed(2)),
    durationMinutes: durationMin,
    pricePerKm: base.pricePerKm,
    multiplier,
    basePrice: base.price,
    finalPrice,
    commissionRate,
    commission,
    driverEarning: parseFloat((finalPrice - commission).toFixed(2)),
    isPeakHour: isPeakHourNow(),
  };
}

async function requestRide(userId, data, io) {
  const { pickupAddress, destinationAddress, pickupPoint, dropoffPoint, originLat, originLng, destLat, destLng, rideType, paymentMethod } = data;

  const distanceKm = await calculateDistance(originLat, originLng, destLat, destLng);
  const durationMin = estimateDuration(distanceKm, 25);

  let rideTypeName = rideType || 'economy';
  let multiplier = 1.0;
  const rideOption = await prisma.rideOption.findFirst({ where: { name: rideTypeName, isActive: true } });
  if (rideOption) multiplier = rideOption.multiplier;

  const commissionRate = await getCommissionRate();
  const base = calculateFare({
    distanceKm,
    durationMinutes: durationMin,
    baseFare: rideOption?.baseFare ? parseFloat(rideOption.baseFare.toString()) : 0,
    pricePerKm: getPricePerKm(rideTypeName),
    pricePerMinute: rideOption?.pricePerMinute ? parseFloat(rideOption.pricePerMinute.toString()) : 0,
    commissionRate,
  });
  const finalPrice = parseFloat((base.price * multiplier).toFixed(2));
  const commission = parseFloat((finalPrice * commissionRate).toFixed(2));
  const driverEarning = parseFloat((finalPrice - commission).toFixed(2));

  // التحقق من رصيد العميل الكافي قبل قبول الطلب (القاعدة #2)
  const effectivePayment = paymentMethod || 'wallet';
  if (effectivePayment === 'wallet') {
    const riderWallet = await prisma.wallet.findUnique({ where: { userId } });
    const bal = riderWallet ? parseFloat(riderWallet.balance.toString()) : 0;
    const reserved = riderWallet ? parseFloat(riderWallet.reservedAmount.toString()) : 0;
    if (bal - reserved < finalPrice) {
      throw new Error('رصيد المحفظة غير كافٍ لقيمة الرحلة المتوقعة');
    }
  }

  const newRide = await prisma.rideRequest.create({
    data: {
      riderId: userId,
      pickupPoint: pickupPoint || '',
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
      commissionRate,
      driverEarning,
      paymentMethod: paymentMethod || 'cash',
      status: 'PENDING',
    },
  });

  // ── جلب بيانات الراكب (تُستخدم في Firestore mirror + Socket + FCM) ──
  const rider = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, phoneNumber: true },
  });
  const riderName = rider ? [rider.firstName, rider.lastName].filter(Boolean).join(' ') : '';
  const riderPhone = rider?.phoneNumber || '';
  const distanceKmNum = Number(newRide.distance) || 0;
  const distanceText = `${distanceKmNum.toFixed(1)} كم`;

  // ── كتابة Mirror في Firestore كـ Real-time Trigger للكابتن ──
  try {
    const db = getFirestore();
    await db.collection('rides').doc(newRide.id).set({
      riderId: userId,
      riderName,
      pickupAddress: newRide.pickupAddress || newRide.pickupPoint,
      destinationAddress: newRide.destinationAddress || newRide.dropoffPoint,
      pickupLat: newRide.originLat,
      pickupLng: newRide.originLng,
      destinationLat: newRide.destLat,
      destinationLng: newRide.destLng,
      fare: Number(newRide.price),
      distance: distanceKmNum,
      distanceText,
      vehicleType: newRide.rideType,
      status: 'pending',
      createdAt: newRide.createdAt,
    });
  } catch (fsError) {
    // غير حرج: فشل الـ Firestore ما يمنعش نجاح الرحلة في PostgreSQL
    console.error('⚠️ Failed to mirror ride to Firestore (non-fatal):', fsError.message);
  }

  // ── إثراء حدث Socket `ride.new_available` للكابتنات المتصلين ──
  // يشمل اسم العميل + هاتفه + السعر (fare/price) + المسافة (رقم + نص)
  // + العناوين + الإحداثيات + نوع المركبة + حالة الرحلة.
  io.to('drivers').emit(SocketEvents.NEW_RIDE_AVAILABLE, {
    id: newRide.id,
    rideId: newRide.id,
    riderId: userId,
    riderName,
    riderPhone,
    pickupAddress: newRide.pickupAddress || newRide.pickupPoint,
    destinationAddress: newRide.destinationAddress || newRide.dropoffPoint,
    originLat: newRide.originLat,
    originLng: newRide.originLng,
    destLat: newRide.destLat,
    destLng: newRide.destLng,
    price: Number(newRide.price),
    fare: Number(newRide.price),
    distance: distanceKmNum,
    distanceKm: distanceKmNum,
    distanceText,
    rideType: newRide.rideType,
    vehicleType: newRide.rideType,
    status: newRide.status,
    _timestamp: new Date().toISOString(),
  });

  // ── إرسال Push Notification (FCM) للكابتنات المتاحين فقط عند إنشاء رحلة جديدة ──
  // يُستدعى فقط عندما تكون حالة الرحلة PENDING / new_ride لضمان وصول الإشعار
  // في الوقت المناسب (قبل قبول أي كابتن للرحلة). غير حرج — لا يكسر تدفق الرحلة.
  if (newRide.status === 'PENDING' || newRide.status === 'new_ride') {
    try {
      const captains = await userRepository.findCaptainsWithTokens();
      if (captains.length > 0) {
        const tokens = captains.map((c) => c.fcmToken).filter(Boolean);
        // إرفاق بيانات الراكب والمسافة النصية بالرحلة ليستخدمها fcm.service في الـ payload
        newRide.riderName = riderName;
        newRide.riderPhone = riderPhone;
        newRide.distanceText = distanceText;
        const result = await notifyCaptainsNewRide(tokens, newRide);
        console.log(
          `📲 FCM new-ride broadcast: sent=${result.sent} failed=${result.failed} invalidTokens=${result.invalidTokens.length}`,
        );
        // تنظيف التوكنات غير الصالحة حتى لا نعيد إرسالها مستقبلاً
        for (const badToken of result.invalidTokens) {
          const bad = captains.find((c) => c.fcmToken === badToken);
          if (bad) {
            await userRepository.updateFcmToken(bad.id, null).catch(() => {});
          }
        }
      }
    } catch (fcmError) {
      console.error('⚠️ FCM new-ride notification error (non-fatal):', fcmError.message);
    }
  }

  return newRide;
}

// ── مزامنة حالة الرحلة مع Firestore mirror (Real-time Trigger للكابتن) ──
async function syncRideStatusToFirestore(rideId, status) {
  try {
    const db = getFirestore();
    await db.collection('rides').doc(rideId).update({ status });
  } catch (fsError) {
    console.error('⚠️ Failed to sync ride status to Firestore (non-fatal):', fsError.message);
  }
}

// ── إنشاء غرفة محادثة ريل تايم في Firestore عند قبول الرحلة ──
// الكابتن والراكب يتبادلان الرسائل مباشرة عبر مجموعة `chats/{rideId}/messages`
// (نفس معرّف الرحلة = معرّف الغرفة، فيكون الربط 1:1 مع الرحلة النشطة).
async function createChatRoom(rideId, riderId, driverId) {
  try {
    const db = getFirestore();
    const chatRef = db.collection('chats').doc(rideId);
    const snap = await chatRef.get();
    if (snap.exists) return; // الغرفة موجودة مسبقاً (مثلاً أنشأها الراكب)

    await chatRef.set({
      rideId,
      riderId,
      driverId,
      createdAt: new Date(),
      lastMessage: '',
      lastMessageAt: new Date(),
      lastSenderId: '',
    });
    console.log(`💬 Created Firestore chat room for ride ${rideId}`);
  } catch (fsError) {
    // غير حرج: فشل إنشاء غرفة المحادثة ما يمنعش نجاح قبول الرحلة
    console.error('⚠️ Failed to create chat room in Firestore (non-fatal):', fsError.message);
  }
}

/**
 * قبول رحلة من كابتن — خصم العمولة فوراً من محفظة الكابتن.
 * (سياسة 2026-08-05): عند القبول تُخصم العمولة (price × commissionRate)
 * وتُسجَّل كحركة COMMISSION بمرحلة on_accept، ولا تُسترد عند إلغاء الكابتن.
 * تُستدعى من مسار الكابتن (captain.service.acceptRide) ومن مسار الكابتن القديم
 * (driver accept-ride في index.js) لضمان نفس السلوك المالي.
 */
async function acceptRide(userId, rideId) {
  // حارس حد الدين قبل الدخول في المعاملة (رسالة واضحة للمستخدم)
  await assertCanAcceptRides(userId);

  return prisma.$transaction(async (tx) => {
    const ride = await tx.rideRequest.findUnique({ where: { id: rideId } });
    if (!ride) throw new Error('الرحلة غير موجودة');
    if (ride.status !== 'PENDING') throw new Error('الرحلة لم تعد متاحة');

    const rate = await getCommissionRate(userId);
    const price = new Prisma.Decimal(ride.price);
    const commission = price.mul(rate).toDecimalPlaces(2);
    const driverEarning = price.minus(commission);

    // حجز الرحلة ذرياً حتى لا يقبلها كابتنان معاً (يُلغى عند فشل المعاملة)
    const claim = await tx.rideRequest.updateMany({
      where: { id: ride.id, status: 'PENDING' },
      data: { driverId: userId, status: 'ACCEPTED' },
    });
    if (claim.count === 0) throw new Error('الرحلة لم تعد متاحة');

    // ضمان وجود محفظة الكابتن
    let capWallet = await tx.wallet.findUnique({ where: { userId } });
    if (!capWallet) {
      capWallet = await tx.wallet.create({
        data: { userId, balance: 0, reservedAmount: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
      });
    }

    // خصم العمولة فوراً من محفظة الكابتن
    const capNewBal = capWallet.balance.minus(commission);
    const minBalance = await getWalletLimit('CAPTAIN_MIN_BALANCE', DEFAULT_LIMITS.CAPTAIN_MIN_BALANCE);
    // لو الرصيد بعد الخصم أقل من حد الدين → ارفض القبول برسالة واضحة
    if (capNewBal.lt(minBalance)) {
      const err = new Error(
        `لا يمكن قبول الرحلة: خصم عمولة ${commission.toString()} ج.م سيجعل رصيدك أقل من حد الدين (${Math.abs(minBalance)} ج). اشحن المحفظة أولاً`
      );
      err.code = 'WALLET_DEBT_LIMIT';
      throw err;
    }

    await tx.wallet.update({ where: { id: capWallet.id }, data: { balance: capNewBal } });
    await tx.walletTransaction.create({
      data: {
        walletId: capWallet.id,
        type: 'COMMISSION',
        amount: commission,
        balanceAfter: capNewBal,
        description: 'عمولة قبول الرحلة',
        status: 'COMPLETED',
        rideId: ride.id,
        metadata: { phase: 'on_accept', rate: rate.toString() },
      },
    });
    console.log(`💰 COMMISSION (on_accept) ${commission.toString()} ج.م خُصمت من محفظة الكابتن ${userId} للرحلة ${ride.id}`);

    const updated = await tx.rideRequest.update({
      where: { id: ride.id },
      data: {
        commission,
        commissionRate: rate,
        driverEarning,
        acceptedAt: new Date(),
        commissionDeductedAtAccept: true,
      },
      include: {
        driver: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, driverProfile: true } },
      },
    });

    return updated;
  });
}

/**
 * يطبّق غرامة تأخير الراكب: خصم من محفظة الراكب + إضافة للكابتن.
 * يُستدعى داخل معاملة، مع منع التكرار عبر الحارس في المستدعي.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} ride
 */
async function _applyLateFee(tx, ride) {
  const { RIDER_LATE_FEE } = await getRidePolicyConfig();
  const fee = new Prisma.Decimal(RIDER_LATE_FEE);

  // إضافة الغرامة لمحفظة الكابتن (دائماً — الكابتن انتظر)
  const capWallet = await tx.wallet.findUnique({ where: { userId: ride.driverId } });
  if (!capWallet) throw new Error('محفظة الكابتن غير موجودة');
  const capNewBal = capWallet.balance.plus(fee);
  await tx.wallet.update({
    where: { id: capWallet.id },
    data: { balance: capNewBal, totalEarned: { increment: fee } },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: capWallet.id,
      type: 'LATE_FEE_CREDIT',
      amount: fee,
      balanceAfter: capNewBal,
      description: 'غرامة تأخير الراكب',
      status: 'COMPLETED',
      rideId: ride.id,
      metadata: { rideId: ride.id, reason: 'rider_late' },
    },
  });

  // خصم الغرامة من محفظة الراكب (لو موجودة ورصيدها كافٍ — وإلا تُسجَّل مستحقة)
  let riderDebited = false;
  const riderWallet = await tx.wallet.findUnique({ where: { userId: ride.riderId } });
  if (riderWallet && riderWallet.balance.gte(fee)) {
    const riderNewBal = riderWallet.balance.minus(fee);
    await tx.wallet.update({ where: { id: riderWallet.id }, data: { balance: riderNewBal } });
    await tx.walletTransaction.create({
      data: {
        walletId: riderWallet.id,
        type: 'LATE_FEE',
        amount: fee,
        balanceAfter: riderNewBal,
        description: 'غرامة تأخير الراكب',
        status: 'COMPLETED',
        rideId: ride.id,
        metadata: { rideId: ride.id, reason: 'rider_late' },
      },
    });
    riderDebited = true;
  } else {
    console.warn(`⚠️ غرامة تأخير الراكب ${ride.riderId} لم تُخصم من محفظته (لا محفظة/رصيد غير كافٍ) — سُجّلت مستحقة`);
  }

  await tx.rideRequest.update({
    where: { id: ride.id },
    data: { lateFeeApplied: true, lateFeeAppliedAt: new Date(), lateFeeAmount: fee },
  });

  console.log(`💰 LATE_FEE ${fee.toString()} ج.م أُضيفت للكابتن ${ride.driverId} (خصم من الراكب: ${riderDebited}) للرحلة ${ride.id}`);
  return { fee, riderDebited };
}

/**
 * إلغاء رحلة وفق سياسة 2026-08-05:
 *  - قبل القبول (PENDING): إلغاء عادي بلا أي حركة محفظة.
 *  - بعد القبول من الكابتن: إلغاء فقط — العمولة المخصومة لا تُسترد أبداً.
 *  - بعد القبول من الراكب: إلغاء + جدولة استرداد مؤجل بعد 60 دقيقة
 *    + غرامة تأخير إن كان الكابتن وصل وانتهى عداد الانتظار دون بدء الرحلة.
 */
async function cancelRide(userId, rideId) {
  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.riderId !== userId && ride.driverId !== userId) throw new Error('ليس لديك صلاحية لإلغاء هذه الرحلة');
  if (ride.status === 'COMPLETED') throw new Error('لا يمكن إلغاء رحلة منتهية');
  if (ride.status === 'CANCELLED') throw new Error('الرحلة ملغاة بالفعل');

  const isRider = ride.riderId === userId;
  const isCaptain = ride.driverId === userId;
  const wasAccepted = ride.status !== 'PENDING' && ride.driverId != null;
  const cancelledBy = isRider ? 'RIDER' : 'CAPTAIN';

  const { COMMISSION_REFUND_DELAY_MINUTES } = await getRidePolicyConfig();
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    // إعادة قراءة الرحلة داخل المعاملة لضمان حالة محدّثة (منع المعالجة المزدوجة)
    const fresh = await tx.rideRequest.findUnique({ where: { id: rideId } });
    if (!fresh || fresh.status === 'CANCELLED') throw new Error('الرحلة ملغاة بالفعل');

    // ── قبل القبول: إلغاء عادي فقط ──
    if (!wasAccepted) {
      return tx.rideRequest.update({
        where: { id: rideId },
        data: { status: 'CANCELLED', cancelledBy, cancelledAt: now },
      });
    }

    // ── بعد القبول (العمولة اتخصمت عند القبول) ──
    const data = { status: 'CANCELLED', cancelledBy, cancelledAt: now };

    if (isRider) {
      // إلغاء من الراكب: لا نسترد العمولة فوراً — نجدد استرداداً مؤجلاً بعد 60 دقيقة
      if (!fresh.commissionRefundedAt && !fresh.pendingCommissionRefundAt) {
        data.pendingCommissionRefundAt = new Date(now.getTime() + COMMISSION_REFUND_DELAY_MINUTES * 60 * 1000);
      }

      // غرامة التأخير: وصل الكابتن + انتهى العداد + لم تبدأ الرحلة + لم تُطبَّق من قبل
      const { RIDER_WAIT_MINUTES } = await getRidePolicyConfig();
      const arrivedAt = fresh.arrivedAt ? new Date(fresh.arrivedAt).getTime() : null;
      const waitMs = RIDER_WAIT_MINUTES * 60 * 1000;
      const timerExpired = arrivedAt != null && Date.now() >= arrivedAt + waitMs;
      const rideStarted = fresh.status === 'STARTED';
      if (timerExpired && !rideStarted && !fresh.lateFeeApplied) {
        await _applyLateFee(tx, fresh);
      }
    }
    // إلغاء من الكابتن: لا استرداد أبداً (لا COMMISSION_REFUND)

    return tx.rideRequest.update({ where: { id: rideId }, data });
  });

  // مزامنة الحالة مع Firestore mirror (غير حرجة)
  await syncRideStatusToFirestore(rideId, 'cancelled');

  return updated;
}

/**
 * تسجيل وصول الكابتن لنقطة الاستلام — يبدأ عداد انتظار الراكب.
 * لا يغيّر الحالة من ACCEPTED (حتى يظل startRide يعمل كما هو).
 */
async function markRideArrived(userId, rideId) {
  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.driverId !== userId) throw new Error('هذه الرحلة ليست مخصصة لك');
  if (ride.status !== 'ACCEPTED') throw new Error('لا يمكن تسجيل الوصول إلا بعد قبول الرحلة');

  const updated = await prisma.rideRequest.update({
    where: { id: rideId },
    data: { arrivedAt: ride.arrivedAt || new Date() },
  });

  // مزامنة الحالة مع Firestore mirror (غير حرجة)
  await syncRideStatusToFirestore(rideId, 'arrived');

  return updated;
}

async function rateRide(userId, { rideId, toUserId, rating, comment }) {
  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.status !== 'COMPLETED') throw new Error('لا يمكن تقييم إلا بعد انتهاء الرحلة');

  const isRider = ride.riderId === userId;
  const isDriver = ride.driverId === userId;
  if (!isRider && !isDriver) throw new Error('غير مصرح: أنت لست طرفاً في هذه الرحلة');
  if (toUserId !== (isRider ? ride.driverId : ride.riderId)) throw new Error('يمكنك فقط تقييم الطرف الآخر في الرحلة');

  // منع التكرار: التحقق لكل مستخدم على حدة
  const existing = await prisma.rating.findFirst({
    where: { rideId, fromUserId: userId },
  });
  if (existing) throw new Error('لقد قمت بتقييم هذه الرحلة من قبل');

  const newRating = await prisma.rating.create({
    data: {
      rideId,
      fromUserId: userId,
      toUserId,
      rating,
      comment: comment || null,
    },
  });

  let averageRating = null;

  // إذا كان التقييم للكابتن → تحديث متوسط تقييماته
  if (ride.driverId === toUserId) {
    const agg = await prisma.rating.aggregate({
      where: { toUserId },
      _avg: { rating: true },
    });
    averageRating = agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0;
    await prisma.driverProfile.update({
      where: { userId: toUserId },
      data: { ratingAvg: averageRating },
    });
  }

  // إشعار للأدمن عند تقييم منخفض (1 أو 2 نجمة) — لا يُفشل العملية عند الخطأ
  if (rating <= 2) {
    createAdminNotification({
      type: 'LOW_RATING',
      title: 'تقييم منخفض',
      body: `تم تسجيل تقييم ${rating} من 5 على رحلة.`,
      data: { rideId, toUserId, rating },
      link: '/ratings',
    });
  }

  return { rating: newRating, averageRating, toUserId };
}

// ── تسوية الرحلة الموحدة (نظام Double-Entry عبر المحفظة) ──
// كل الحركات المالية تُسجَّل كمعاملات على محافظ العميل/الكابتن/المنصة،
// ولا يتم المساس بـ DriverProfile.balance (مهمَل — المحفظة هي المصدر الوحيد للأرصدة).
//
// سياسة 2026-08-05: العمولة تُخصم فوراً عند القبول (phase: on_accept).
// لذلك عند الإكمال لا تُخصم عمولة الشركة مرة ثانية:
//   - wallet:  خصم price من الراكب، وإضافة price للكابتن
//              (صافي الكابتن = price − العمولة المخصومة عند القبول = driverEarning)
//   - cash:    لا خصم عمولة ثانٍ (اتخصمت عند القبول) — تحديث إحصائيات فقط
//   - card:    إضافة price للكابتن (نفس منطق wallet)
// الرحلات القديمة (قبل السياسة، commissionDeductedAtAccept=false) تحافظ
// على السلوك السابق حتى لا تُكسَر الرحلات الجارية أثناء الترقية.
async function _settleRideCore(tx, { rideId, driverId }) {
  // جلب الرحلة مع حقل isPaid للتحقق من عدم التكرار
  const ride = await tx.rideRequest.findUnique({
    where: { id: rideId },
    select: {
      id: true,
      riderId: true,
      driverId: true,
      price: true,
      paymentMethod: true,
      status: true,
      isPaid: true,
      commission: true,
      commissionRate: true,
      driverEarning: true,
      commissionDeductedAtAccept: true,
    },
  });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.driverId && ride.driverId !== driverId) throw new Error('هذه الرحلة ليست مخصصة لك');
  if (ride.status === 'COMPLETED' && ride.isPaid) throw new Error('تم تسوية هذه الرحلة مسبقاً');
  if (ride.status !== 'STARTED' && ride.status !== 'COMPLETED') throw new Error('لا يمكن تسوية رحلة في هذه الحالة');

  const price = new Prisma.Decimal(ride.price);

  // ── هل خُصمت العمولة عند القبول؟ ──
  const commissionDeducted = ride.commissionDeductedAtAccept;

  let commission;
  let driverEarning;
  let rate;
  if (commissionDeducted) {
    // نستخدم القيم المخزنة عند القبول (لا نعيد الحساب حتى لا يتغير السعر/النسبة)
    commission = new Prisma.Decimal(ride.commission || 0);
    driverEarning = new Prisma.Decimal(ride.driverEarning || 0);
    rate = ride.commissionRate || new Prisma.Decimal(0);
  } else {
    // رحلة قديمة (قبل السياسة): نحافظ على الحساب السابق
    rate = await getCommissionRate(driverId);
    commission = price.mul(rate).toDecimalPlaces(2);
    driverEarning = price.minus(commission);
  }

  const paymentMethod = ride.paymentMethod || 'wallet';

  // معالجة مالية حسب طريقة الدفع
  if (paymentMethod === 'wallet') {
    // ── الدفع من المحفظة ──────────────────────────
    // خصم قيمة الرحلة كاملة من محفظة الراكب
    const riderWallet = await tx.wallet.findUnique({ where: { userId: ride.riderId } });
    if (!riderWallet || riderWallet.balance.lt(price)) {
      throw new Error('رصيد العميل غير كافٍ لخصم قيمة الرحلة');
    }
    const riderNewBal = riderWallet.balance.minus(price);
    await tx.wallet.update({ where: { id: riderWallet.id }, data: { balance: riderNewBal } });
    await tx.walletTransaction.create({
      data: {
        walletId: riderWallet.id,
        type: 'RIDE_DEDUCTION',
        amount: price,
        balanceAfter: riderNewBal,
        description: `خصم قيمة الرحلة ${ride.id}`,
        status: 'COMPLETED',
        rideId: ride.id,
      },
    });

    // إضافة للكابتن: العمولة اتخصمت عند القبول → يُضاف له السعر الكامل
    // (صافي الربح = السعر − العمولة المخصومة سابقاً = driverEarning)
    const capWallet = await tx.wallet.findUnique({ where: { userId: ride.driverId } });
    if (!capWallet) throw new Error('محفظة الكابتن غير موجودة');
    const capCredit = commissionDeducted ? price : driverEarning;
    const capNewBal = capWallet.balance.plus(capCredit);
    await tx.wallet.update({
      where: { id: capWallet.id },
      data: { balance: capNewBal, totalEarned: { increment: driverEarning } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: capWallet.id,
        type: 'DRIVER_EARNING',
        amount: capCredit,
        balanceAfter: capNewBal,
        description: commissionDeducted
          ? `أرباح الرحلة ${ride.id} (العمولة خُصمت عند القبول)`
          : `أرباح الرحلة ${ride.id}`,
        status: 'COMPLETED',
        rideId: ride.id,
        metadata: { net: driverEarning.toString(), commissionDeductedAtAccept: commissionDeducted },
      },
    });
  } else if (paymentMethod === 'cash') {
    // ── الدفع نقداً ───────────────────────────────
    // الكابتن قبض كامل القيمة من الراكب.
    const capWallet = await tx.wallet.findUnique({ where: { userId: ride.driverId } });
    if (!capWallet) throw new Error('محفظة الكابتن غير موجودة');

    if (commissionDeducted) {
      // العمولة اتخصمت عند القبول → لا خصم ثانٍ، تحديث الإحصائيات فقط
      await tx.wallet.update({
        where: { id: capWallet.id },
        data: { totalEarned: { increment: driverEarning } },
      });
      console.log(`✅ كاش ${ride.id}: العمولة خُصمت عند القبول — لا خصم ثانٍ من الكابتن`);
    } else {
      // رحلة قديمة: خصم العمولة الآن كما في السلوك السابق
      const capNewBal = capWallet.balance.minus(commission);
      const minBalance = await getWalletLimit(
        'CAPTAIN_MIN_BALANCE',
        DEFAULT_LIMITS.CAPTAIN_MIN_BALANCE
      );
      // لو (الرصيد - العمولة) < حد الدين → ارفض التسوية حتى لا يزداد الدين
      if (capNewBal.lt(minBalance)) {
        throw new Error(
          `رصيدك وصل لحد الدين (${Math.abs(minBalance)} ج). اشحن المحفظة لإكمال الرحلات`
        );
      }
      await tx.wallet.update({
        where: { id: capWallet.id },
        data: { balance: capNewBal, totalEarned: { increment: driverEarning } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: capWallet.id,
          type: 'COMMISSION',
          amount: commission,
          balanceAfter: capNewBal,
          description: `عمولة التطبيق ${rate.toString()} - الرحلة ${ride.id} (كاش)`,
          status: 'COMPLETED',
          rideId: ride.id,
          metadata: { rate: rate.toString(), net: driverEarning.toString(), phase: 'on_settle_legacy' },
        },
      });
    }
  } else {
    // ── الدفع أونلاين / بطاقة ─────────────────────
    // المنصة تستلم قيمة الرحلة وتضيف للكابتن (السعر الكامل لو العمولة اتخصمت)
    const capWallet = await tx.wallet.findUnique({ where: { userId: ride.driverId } });
    if (!capWallet) throw new Error('محفظة الكابتن غير موجودة');
    const capCredit = commissionDeducted ? price : driverEarning;
    const capNewBal = capWallet.balance.plus(capCredit);
    await tx.wallet.update({
      where: { id: capWallet.id },
      data: { balance: capNewBal, totalEarned: { increment: driverEarning } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: capWallet.id,
        type: 'DRIVER_EARNING',
        amount: capCredit,
        balanceAfter: capNewBal,
        description: commissionDeducted
          ? `أرباح الرحلة ${ride.id} (${paymentMethod}) — العمولة خُصمت عند القبول`
          : `أرباح الرحلة ${ride.id} (${paymentMethod})`,
        status: 'COMPLETED',
        rideId: ride.id,
        metadata: { net: driverEarning.toString(), commissionDeductedAtAccept: commissionDeducted },
      },
    });
  }

  // تثبيت القيم المالية على الرحلة + إغلاقها
  const updated = await tx.rideRequest.update({
    where: { id: ride.id },
    data: {
      status: 'COMPLETED',
      isPaid: true,
      paidAt: new Date(),
      commission,
      driverEarning,
      commissionRate: rate,
    },
  });

  // تحديث عداد الرحلات للكابتن
  await tx.driverProfile.update({
    where: { userId: ride.driverId },
    data: { totalTrips: { increment: 1 } },
  });

  return { updatedRide: updated, ride };
}

/**
 * settleRide — نقطة الدخول الموحدة لتسوية رحلة مكتملة.
 * @param {object} [tx] معاملة Prisma اختيارية (للدمج داخل transaction خارجي)
 * @param {object} params { rideId, driverId }
 */
async function settleRide(tx, { rideId, driverId } = {}) {
  if (tx) return _settleRideCore(tx, { rideId, driverId });
  return prisma.$transaction(async (t) => _settleRideCore(t, { rideId, driverId }));
}

// ─────────────────────────────────────────────────────────────
// عمال الخلفية لسياسة الرحلات (DB كمصدر حقيقة — لا setTimeout غير موثوق)
// ─────────────────────────────────────────────────────────────

/**
 * العامل المسؤول عن الاسترداد المؤجل للعمولة (إلغاء الراكب بعد القبول).
 * يفحص كل دقيقة الرحلات الملغاة من الراكب التي استحقّ استردادها
 * (pendingCommissionRefundAt <= now) ويمنع الاسترداد المزدوج عبر
 * تحديث ذري شرطي (commissionRefundedAt = null).
 * @returns {Promise<number>} عدد الرحلات المعالجة
 */
async function processDueCommissionRefunds() {
  const now = new Date();
  let processed = 0;
  try {
    const dueRides = await prisma.rideRequest.findMany({
      where: {
        status: 'CANCELLED',
        cancelledBy: 'RIDER',
        pendingCommissionRefundAt: { lte: now },
        commissionRefundedAt: null,
      },
      take: 100,
    });

    for (const ride of dueRides) {
      try {
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.rideRequest.findUnique({ where: { id: ride.id } });
          if (!fresh || fresh.status !== 'CANCELLED' || fresh.commissionRefundedAt) return; // منع التكرار
          if (!fresh.pendingCommissionRefundAt || new Date(fresh.pendingCommissionRefundAt) > new Date()) return;

          // حجز ذري: يضمن أن رحلاً واحداً فقط يعالج الاسترداد
          const claim = await tx.rideRequest.updateMany({
            where: { id: fresh.id, status: 'CANCELLED', commissionRefundedAt: null },
            data: { commissionRefundedAt: new Date() },
          });
          if (claim.count === 0) return;

          if (fresh.commissionDeductedAtAccept) {
            const commission = new Prisma.Decimal(fresh.commission || 0);
            if (commission.gt(0)) {
              const capWallet = await tx.wallet.findUnique({ where: { userId: fresh.driverId } });
              if (capWallet) {
                const capNewBal = capWallet.balance.plus(commission);
                await tx.wallet.update({ where: { id: capWallet.id }, data: { balance: capNewBal } });
                await tx.walletTransaction.create({
                  data: {
                    walletId: capWallet.id,
                    type: 'COMMISSION_REFUND',
                    amount: commission,
                    balanceAfter: capNewBal,
                    description: 'استرداد عمولة بعد إلغاء الراكب',
                    status: 'COMPLETED',
                    rideId: fresh.id,
                    metadata: { phase: 'rider_cancel', rideId: fresh.id, reason: 'rider_cancel' },
                  },
                });
                console.log(`💰 COMMISSION_REFUND ${commission.toString()} ج.م أُعيدت للكابتن ${fresh.driverId} للرحلة ${fresh.id}`);
              }
            }
          } else {
            console.log(`↩️ رحلة ${fresh.id}: لا عمولة مخصومة عند القبول (رحلة قديمة) — لا استرداد`);
          }
        });
        processed += 1;
      } catch (err) {
        console.error(`⚠️ فشل استرداد عمولة الرحلة ${ride.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('⚠️ processDueCommissionRefunds error:', err.message);
  }
  if (processed > 0) console.log(`🔄 اكتمل فحص الاسترداد المؤجل: تمت معالجة ${processed} رحلة`);
  return processed;
}

/**
 * العامل المسؤول عن غرامة تأخير الراكب (Waiting / No-show fee).
 * يفحص كل دقيقة الرحلات التي وصل فيها الكابتن (arrivedAt) وانتهى عداد
 * الانتظار (RIDER_WAIT_MINUTES) دون أن تبدأ الرحلة، فيطبّق الغرامة
 * (خصم من الراكب + إضافة للكابتن) مرة واحدة فقط.
 * @returns {Promise<number>} عدد الرحلات المعالجة
 */
async function processDueLateFees() {
  const { RIDER_WAIT_MINUTES } = await getRidePolicyConfig();
  const waitMs = RIDER_WAIT_MINUTES * 60 * 1000;
  const cutoff = new Date(Date.now() - waitMs);
  let processed = 0;
  try {
    const dueRides = await prisma.rideRequest.findMany({
      where: {
        status: { in: ['ACCEPTED', 'ARRIVED'] },
        arrivedAt: { not: null, lte: cutoff },
        lateFeeApplied: false,
      },
      take: 100,
    });

    for (const ride of dueRides) {
      try {
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.rideRequest.findUnique({ where: { id: ride.id } });
          if (!fresh || fresh.lateFeeApplied) return; // منع التكرار
          // لو بدأت الرحلة قبل انتهاء العداد → لا غرامة (مُعالجة في الشرط أدناه)
          if (fresh.status === 'STARTED' || fresh.status === 'COMPLETED') return;
          if (!fresh.arrivedAt) return;
          if (new Date(fresh.arrivedAt).getTime() + waitMs > Date.now()) return;

          // حجز ذري: يضمن تطبيق الغرامة مرة واحدة فقط
          const claim = await tx.rideRequest.updateMany({
            where: { id: fresh.id, lateFeeApplied: false },
            data: { lateFeeApplied: true, lateFeeAppliedAt: new Date() },
          });
          if (claim.count === 0) return;

          await _applyLateFee(tx, fresh);
        });
        processed += 1;
      } catch (err) {
        console.error(`⚠️ فشل تطبيق غرامة تأخير الرحلة ${ride.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('⚠️ processDueLateFees error:', err.message);
  }
  if (processed > 0) console.log(`🔄 اكتمل فحص غرامة التأخير: تمت معالجة ${processed} رحلة`);
  return processed;
}

let _workersStarted = false;
const WORKER_INTERVAL_MS = 60 * 1000; // كل دقيقة

/**
 * يبدأ عمال الخلفية لسياسة الرحلات (استرداد مؤجل + غرامة تأخير).
 * يُستدعى مرة واحدة عند تشغيل السيرفر. كل عامل يعمل بشكل مستقل
 * مع try/catch داخلي — فشل أحدهما لا يوقف الآخر.
 */
function startRidePolicyWorkers() {
  if (_workersStarted) return;
  _workersStarted = true;

  // فحص أولي عند الإقلاع (يلتقط أي رحلات استحقت أثناء توقف السيرفر)
  processDueCommissionRefunds().catch((e) => console.error('⚠️ initial refund pass:', e?.message));
  processDueLateFees().catch((e) => console.error('⚠️ initial late-fee pass:', e?.message));

  setInterval(() => {
    processDueCommissionRefunds().catch((e) => console.error('⚠️ refund worker:', e?.message));
  }, WORKER_INTERVAL_MS);

  setInterval(() => {
    processDueLateFees().catch((e) => console.error('⚠️ late-fee worker:', e?.message));
  }, WORKER_INTERVAL_MS);

  console.log('🛠️  تم تشغيل عمال سياسة الرحلات (استرداد مؤجل كل دقيقة + غرامة تأخير كل دقيقة)');
}

module.exports = {
  getRideOptions,
  calculateRideFare,
  requestRide,
  cancelRide,
  rateRide,
  getCommissionRate,
  settleRide,
  acceptRide,
  markRideArrived,
  processDueCommissionRefunds,
  processDueLateFees,
  startRidePolicyWorkers,
  syncRideStatusToFirestore,
  createChatRoom,
  resetConfigCache,
};
