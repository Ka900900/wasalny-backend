const prisma = require('../config/prisma');
const { Prisma } = require('@prisma/client');
const { haversineDistance, getGovernorateFromCoords } = require('../services/geo');
const { getCommissionRate, settleRide, syncRideStatusToFirestore, createChatRoom } = require('./ride.service');
const { assertCanAcceptRides } = require('../config/wallet.constants');
const { createCaptainPendingNotification } = require('./notification.service');

async function updateLocation(userId, lat, lng, residenceGovernorate) {
  // ── حارس التوثيق: لا يمكن للكابتن المعلق/المرفوض تحديث موقعه أو الظهور كمتاح ──
  const existingProfile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (existingProfile && existingProfile.verificationStatus !== 'APPROVED') {
    const stateLabel = existingProfile.verificationStatus === 'REJECTED' ? 'مرفوض' : 'قيد المراجعة';
    throw new Error(`لم يتم اعتماد حسابك بعد (الحالة: ${stateLabel}). لا يمكنك استقبال الرحلات.`);
  }

  // البحث عن المركبة لاستخدام بياناتها الحقيقية في حال إنشاء DriverProfile
  const vehicle = await prisma.vehicle.findFirst({ where: { userId } });
  if (!vehicle) {
    throw new Error('برجاء تسجيل بيانات المركبة أولاً قبل تفعيل حالة التوفر');
  }

  // تحديد المحافظة السكنية:
  //  - القيمة المرسلة صراحةً من التطبيق لها الأولوية.
  //  - عند إنشاء الملف لأول مرة (تسجيل كابتن جديد) تُحدَّد تلقائيًا من الإحداثيات.
  //  - عند التحديث فقط (بدون إرسال قيمة) تبقى المحافظة الحالية دون تغيير.
  const explicitGov = typeof residenceGovernorate === 'string' ? residenceGovernorate.trim() : '';
  const isNewProfile = !existingProfile;
  const governorate = explicitGov
    ? explicitGov
    : isNewProfile
      ? getGovernorateFromCoords(lat, lng)
      : undefined;

  const profile = await prisma.driverProfile.upsert({
    where: { userId },
    update: {
      currentLat: lat,
      currentLng: lng,
      ...(governorate ? { residenceGovernorate: governorate } : {}),
    },
    create: {
      userId,
      currentLat: lat,
      currentLng: lng,
      ...(governorate ? { residenceGovernorate: governorate } : {}),
      carModel: `${vehicle.make} ${vehicle.model}`,
      carColor: vehicle.color,
      carPlateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      carPhotoUrl: vehicle.licenseFrontUrl,
      // الملف الجديد يبدأ بحالة PENDING → يبقى غير متاح حتى الاعتماد
      isAvailable: false,
    },
  });

  // إشعار للأدمن عند إنشاء ملف كابتن جديد لأول مرة (تسجيل كابتن جديد — لا يُفشل العملية عند الخطأ)
  if (isNewProfile) {
    createCaptainPendingNotification(userId, {
      type: 'CAPTAIN_PENDING',
      title: 'كابتن جديد بانتظار المراجعة',
      body: 'سجّل كابتن جديد بحالة "قيد المراجعة". راجع مستنداته للاعتماد.',
      link: '/captains',
    });
  }

  return profile;
}

async function getAvailableRides(userId, searchRadiusKm = 5) {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!driverProfile || driverProfile.currentLat === null || driverProfile.currentLng === null) {
    throw new Error('موقع الكابتن غير محدد. يرجى تحديث موقعك أولاً.');
  }

  // ── حارس التوثيق: فقط الكابتن المعتمد يمكنه جلب الرحلات المتاحة ──
  if (driverProfile.verificationStatus !== 'APPROVED') {
    const stateLabel = driverProfile.verificationStatus === 'REJECTED' ? 'مرفوض' : 'قيد المراجعة';
    throw new Error(`لم يتم اعتماد حسابك بعد (الحالة: ${stateLabel}). لا يمكنك استقبال الرحلات.`);
  }

  const pendingRides = await prisma.rideRequest.findMany({
    where: { status: 'PENDING' },
    include: { rider: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const ridesWithDistance = pendingRides
    .map((ride) => ({
      ...ride,
      distanceFromDriver: haversineDistance(driverProfile.currentLat, driverProfile.currentLng, ride.originLat, ride.originLng),
    }))
    .filter((ride) => ride.distanceFromDriver <= searchRadiusKm)
    .sort((a, b) => a.distanceFromDriver - b.distanceFromDriver);

  return {
    driverLocation: { lat: driverProfile.currentLat, lng: driverProfile.currentLng },
    searchRadiusKm,
    rides: ridesWithDistance,
  };
}

async function acceptRide(userId, rideId) {
  // حارس حد الدين: لا يمكن قبول رحلات إذا كان الرصيد عند حد الدين أو أقل
  await assertCanAcceptRides(userId);

  // ── حارس التوثيق: لا يمكن لكابتن غير معتمد قبول الرحلات ──
  const captainProfile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!captainProfile || captainProfile.verificationStatus !== 'APPROVED') {
    throw new Error('لم يتم اعتماد حسابك بعد، لا يمكنك قبول الرحلات.');
  }

  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.status !== 'PENDING') throw new Error('الرحلة لم تعد متاحة');

  const updated = await prisma.rideRequest.update({
    where: { id: rideId },
    data: { driverId: userId, status: 'ACCEPTED' },
    include: {
      driver: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, driverProfile: true } },
    },
  });

  // مزامنة الحالة مع Firestore mirror (غير حرجة)
  await syncRideStatusToFirestore(rideId, 'accepted');

  // إنشاء غرفة محادثة ريل تايم في Firestore (غير حرجة)
  await createChatRoom(rideId, ride.riderId, userId);

  return updated;
}

async function startRide(userId, rideId) {
  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('الرحلة غير موجودة');
  if (ride.driverId !== userId) throw new Error('هذه الرحلة ليست مخصصة لك');
  if (ride.status !== 'ACCEPTED') throw new Error('لا يمكن بدء رحلة إلا بعد قبولها');

  const updated = await prisma.rideRequest.update({ where: { id: rideId }, data: { status: 'STARTED' } });

  // مزامنة الحالة مع Firestore mirror (غير حرجة)
  await syncRideStatusToFirestore(rideId, 'started');

  return updated;
}

async function completeRide(userId, rideId) {
  const result = await prisma.$transaction(async (tx) => {
    // settleRide تتعامل مع جميع طرق الدفع (wallet / cash / online / card)
    return settleRide(tx, { rideId, driverId: userId });
  });

  // مزامنة الحالة مع Firestore mirror (غير حرجة) — بعد نجاح المعاملة
  await syncRideStatusToFirestore(rideId, 'completed');

  return result;
}

module.exports = { updateLocation, getAvailableRides, acceptRide, startRide, completeRide };
