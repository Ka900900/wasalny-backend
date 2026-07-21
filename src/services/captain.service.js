const prisma = require('../config/prisma');
const { Prisma } = require('@prisma/client');
const { haversineDistance } = require('../services/geo');
const { getCommissionRate, settleRide, syncRideStatusToFirestore, createChatRoom } = require('./ride.service');

async function updateLocation(userId, lat, lng) {
  // البحث عن المركبة لاستخدام بياناتها الحقيقية في حال إنشاء DriverProfile
  const vehicle = await prisma.vehicle.findFirst({ where: { userId } });
  if (!vehicle) {
    throw new Error('برجاء تسجيل بيانات المركبة أولاً قبل تفعيل حالة التوفر');
  }

  return prisma.driverProfile.upsert({
    where: { userId },
    update: { currentLat: lat, currentLng: lng },
    create: {
      userId,
      currentLat: lat,
      currentLng: lng,
      carModel: `${vehicle.make} ${vehicle.model}`,
      carColor: vehicle.color,
      carPlateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      carPhotoUrl: vehicle.licenseFrontUrl,
    },
  });
}

async function getAvailableRides(userId, searchRadiusKm = 5) {
  const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!driverProfile || driverProfile.currentLat === null || driverProfile.currentLng === null) {
    throw new Error('موقع الكابتن غير محدد. يرجى تحديث موقعك أولاً.');
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
    // تحقق مبدئي من ملكية الرحلة وحالتها
    const ride = await tx.rideRequest.findUnique({
      where: { id: rideId },
      select: { id: true, driverId: true, status: true, paymentMethod: true },
    });
    if (!ride) throw new Error('الرحلة غير موجودة');
    if (ride.driverId !== userId) throw new Error('هذه الرحلة ليست مخصصة لك');
    if (ride.status !== 'STARTED') throw new Error('لا يمكن إنهاء رحلة لم تبدأ بعد');

    // الدفع من المحفظة: خصم العميل + أرباح الكابتن فوراً (محفظتنا الداخلية موثوقة)
    if ((ride.paymentMethod || 'wallet') === 'wallet') {
      return settleRide(tx, { rideId, driverId: userId });
    }

    // الدفع ببطاقة: ننهي الرحلة فقط، والتسوية المالية تتم بعد تأكيد كاشير (webhook/verify)
    const updated = await tx.rideRequest.update({ where: { id: rideId }, data: { status: 'COMPLETED' } });
    return { updatedRide: updated, ride };
  });

  // مزامنة الحالة مع Firestore mirror (غير حرجة) — بعد نجاح المعاملة
  await syncRideStatusToFirestore(rideId, 'completed');

  return result;
}

module.exports = { updateLocation, getAvailableRides, acceptRide, startRide, completeRide };
