const prisma = require('../config/prisma');
const { getFirestore } = require('../config/firebase');
const { calculateDistance, estimateDuration, calculateFare, haversineDistance } = require('./geo');
const { emitRideStatus, SocketEvents } = require('../config/socket');
const { Prisma } = require('@prisma/client');
const { notifyCaptainsNewRide } = require('./fcm.service');
const userRepository = require('../repositories/user.repository');

// ── نسبة العمولة من Config (قابلة للتعديل من غير كود، افتراضي 8%) ──
let _commissionRateCache = null;
let _commissionRateCacheAt = 0;
async function getCommissionRate() {
  const now = Date.now();
  if (_commissionRateCache !== null && now - _commissionRateCacheAt < 5 * 60 * 1000) {
    return _commissionRateCache;
  }
  const cfg = await prisma.config.findUnique({ where: { key: 'COMMISSION_RATE' } });
  const rate = cfg ? parseFloat(cfg.value) : 0.08;
  _commissionRateCache = rate;
  _commissionRateCacheAt = now;
  return rate;
}

async function getRideOptions() {
  let options = await prisma.rideOption.findMany({ where: { isActive: true }, orderBy: { pricePerKm: 'asc' } });

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

  return options;
}

async function calculateRideFare({ originLat, originLng, destLat, destLng, rideType }) {
  const distanceKm = await calculateDistance(originLat, originLng, destLat, destLng);
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

  return {
    distance: parseFloat(distanceKm.toFixed(2)),
    durationMinutes: durationMin,
    pricePerKm: baseFare.pricePerKm,
    multiplier,
    basePrice: baseFare.price,
    finalPrice,
    commissionRate,
    commission,
    driverEarning: parseFloat((finalPrice - commission).toFixed(2)),
    isPeakHour: require('./geo').getPricePerKm() > 7,
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
    pricePerKm: getPricePerKm(),
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

  // ── كتابة Mirror في Firestore كـ Real-time Trigger للكابتن ──
  try {
    const rider = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const db = getFirestore();
    await db.collection('rides').doc(newRide.id).set({
      riderId: userId,
      riderName: rider ? `${rider.firstName} ${rider.lastName}` : '',
      pickupAddress: newRide.pickupAddress || newRide.pickupPoint,
      destinationAddress: newRide.destinationAddress || newRide.dropoffPoint,
      pickupLat: newRide.originLat,
      pickupLng: newRide.originLng,
      destinationLat: newRide.destLat,
      destinationLng: newRide.destLng,
      fare: Number(newRide.price),
      vehicleType: newRide.rideType,
      status: 'pending',
      createdAt: newRide.createdAt,
    });
  } catch (fsError) {
    // غير حرج: فشل الـ Firestore ما يمنعش نجاح الرحلة في PostgreSQL
    console.error('⚠️ Failed to mirror ride to Firestore (non-fatal):', fsError.message);
  }

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

  // ── إرسال Push Notification (FCM) للكابتنات عند إنشاء رحلة جديدة ──
  // يُستدعى فقط عندما تكون حالة الرحلة PENDING / new_ride لضمان وصول الإشعار
  // في الوقت المناسب (قبل قبول أي كابتن للرحلة). غير حرج — لا يكسر تدفق الرحلة.
  if (newRide.status === 'PENDING' || newRide.status === 'new_ride') {
    try {
      const captains = await userRepository.findCaptainsWithTokens();
      if (captains.length > 0) {
        const tokens = captains.map((c) => c.fcmToken).filter(Boolean);
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

async function cancelRide(userId, rideId) {
  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.riderId !== userId && ride.driverId !== userId) throw new Error('ليس لديك صلاحية لإلغاء هذه الرحلة');
  if (ride.status === 'COMPLETED') throw new Error('لا يمكن إلغاء رحلة منتهية');

  const updated = await prisma.rideRequest.update({ where: { id: rideId }, data: { status: 'CANCELLED' } });

  // مزامنة الحالة مع Firestore mirror (غير حرجة)
  await syncRideStatusToFirestore(rideId, 'cancelled');

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

  const existing = await prisma.rating.findUnique({ where: { rideId } });
  if (existing) throw new Error('تم تقييم هذه الرحلة بالفعل');

  const newRating = await prisma.rating.create({ data: { rideId, fromUserId: userId, toUserId, rating, comment: comment || null } });

  if (ride.driverId === toUserId) {
    const avg = await prisma.rating.aggregate({ where: { toUserId }, _avg: { rating: true } });
    await prisma.driverProfile.update({ where: { userId: toUserId }, data: { ratingAvg: avg._avg.rating || 0 } });
  }

  return newRating;
}

// ── تسوية الرحلة الموحدة (نظام Double-Entry عبر المحفظة) ──
// كل الحركات المالية تُسجَّل كمعاملات على محافظ العميل/الكابتن/المنصة،
// ولا يتم المساس بـ DriverProfile.balance (مهمَل — المحفظة هي المصدر الوحيد للأرصدة).
async function _settleRideCore(tx, { rideId, driverId }) {
  const ride = await tx.rideRequest.findUnique({
    where: { id: rideId },
    select: { id: true, riderId: true, driverId: true, price: true, paymentMethod: true, status: true },
  });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.driverId && ride.driverId !== driverId) throw new Error('هذه الرحلة ليست مخصصة لك');
  if (ride.status === 'COMPLETED' && ride.isPaid) throw new Error('تم تسوية هذه الرحلة مسبقاً');
  if (ride.status !== 'STARTED' && ride.status !== 'COMPLETED') throw new Error('لا يمكن تسوية رحلة في هذه الحالة');

  const rate = await getCommissionRate();
  const price = new Prisma.Decimal(ride.price);
  const commission = price.mul(rate).toDecimalPlaces(2);
  const net = price.minus(commission);

  // 1) خصم قيمة الرحلة من محفظة العميل (في حال الدفع من المحفظة)
  if ((ride.paymentMethod || 'wallet') === 'wallet') {
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
  }

  // 2) أرباح الكابتن: إجمالي القيمة ثم خصم عمولة التطبيق (نصيب المنصة)
  const capWallet = await tx.wallet.findUnique({ where: { userId: ride.driverId } });
  if (!capWallet) throw new Error('محفظة الكابتن غير موجودة');

  const capAfterEarn = capWallet.balance.plus(price);
  await tx.wallet.update({
    where: { id: capWallet.id },
    data: { balance: capAfterEarn, totalEarned: { increment: net } },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: capWallet.id,
      type: 'DRIVER_EARNING',
      amount: price,
      balanceAfter: capAfterEarn,
      description: `أرباح الرحلة ${ride.id} (إجمالي)`,
      status: 'COMPLETED',
      rideId: ride.id,
    },
  });

  const capAfterComm = capAfterEarn.minus(commission);
  await tx.wallet.update({ where: { id: capWallet.id }, data: { balance: capAfterComm } });
  await tx.walletTransaction.create({
    data: {
      walletId: capWallet.id,
      type: 'COMMISSION',
      amount: commission,
      balanceAfter: capAfterComm,
      description: `عمولة التطبيق ${(rate * 100).toString()}%`,
      status: 'COMPLETED',
      rideId: ride.id,
      metadata: { rate: rate.toString(), net: net.toString() },
    },
  });

  // 3) تثبيت القيم المالية على الرحلة + إغلاقها
  const updated = await tx.rideRequest.update({
    where: { id: ride.id },
    data: {
      status: 'COMPLETED',
      isPaid: true,
      paidAt: new Date(),
      commission,
      driverEarning: net,
      commissionRate: rate,
    },
  });

  // 4) تحديث عداد الرحلات فقط — لا نمسّ DriverProfile.balance (مهمل)
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

module.exports = { getRideOptions, calculateRideFare, requestRide, cancelRide, rateRide, getCommissionRate, settleRide, syncRideStatusToFirestore, createChatRoom };
