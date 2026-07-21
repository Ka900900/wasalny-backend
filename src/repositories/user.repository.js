const prisma = require('../config/prisma');

async function findByFirebaseUid(firebaseUid) {
  return prisma.user.findUnique({ where: { firebaseUid } });
}

async function findByPhone(phoneNumber) {
  return prisma.user.findUnique({ where: { phoneNumber } });
}

async function createUser(data) {
  return prisma.user.create({ data });
}

async function updateLastLogin(id) {
  return prisma.user.update({
    where: { id },
    data: {
      lastLoginAt: new Date(),
    },
  });
}

async function updateFcmToken(id, fcmToken) {
  return prisma.user.update({
    where: { id },
    data: {
      fcmToken: fcmToken || null,
    },
  });
}

async function findCaptainsWithTokens() {
  // Captains who have registered an FCM token and are active.
  return prisma.user.findMany({
    where: {
      role: 'DRIVER',
      isActive: true,
      fcmToken: { not: null },
    },
    select: { id: true, fcmToken: true },
  });
}

async function setDriverAvailability(userId, isAvailable) {
  // البحث عن المركبة لاستخدام بياناتها الحقيقية في حال إنشاء DriverProfile
  const vehicle = await prisma.vehicle.findFirst({ where: { userId } });
  if (!vehicle) {
    throw new Error('برجاء تسجيل بيانات المركبة أولاً قبل تفعيل حالة التوفر');
  }

  return prisma.driverProfile.upsert({
    where: { userId },
    update: { isAvailable: !!isAvailable },
    create: {
      userId,
      isAvailable: !!isAvailable,
      carModel: `${vehicle.make} ${vehicle.model}`,
      carColor: vehicle.color,
      carPlateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      carPhotoUrl: vehicle.licenseFrontUrl,
    },
  });
}

module.exports = {
  findByFirebaseUid,
  findByPhone,
  createUser,
  updateLastLogin,
  updateFcmToken,
  findCaptainsWithTokens,
  setDriverAvailability,
};
