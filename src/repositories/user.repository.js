const prisma = require('../config/prisma');
const { assertCanAcceptRides } = require('../config/wallet.constants');

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
  // الكابتنات المتاحون فقط (online): role = DRIVER + نشط + لديه FCM token
  // + DriverProfile.isAvailable === true (أي أن الكابتن مفتوح لاستقبال الرحلات).
  // هذا يمنع إرسال إشعار رحلة جديدة لكابتن Offline / غير متاح.
  return prisma.user.findMany({
    where: {
      role: 'DRIVER',
      isActive: true,
      fcmToken: { not: null },
      driverProfile: { is: { isAvailable: true } },
    },
    select: { id: true, fcmToken: true },
  });
}

async function setDriverAvailability(userId, isAvailable) {
  // حارس حد الدين: عند التفعيل (online) يُمنع إذا كان الرصيد عند حد الدين أو أقل
  if (isAvailable) {
    await assertCanAcceptRides(userId);
  }

  // 1. التحقق من وجود DriverProfile مسبقاً
  const existingProfile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (existingProfile) {
    // الـ Profile موجود → تحديث حالة التوفر فقط
    return prisma.driverProfile.update({
      where: { userId },
      data: { isAvailable: !!isAvailable },
    });
  }

  // 2. الـ Profile غير موجود → التحقق من وجود مركبة لإنشاء Profile جديد
  const vehicle = await prisma.vehicle.findFirst({ where: { userId } });
  if (!vehicle) {
    throw new Error('برجاء تسجيل بيانات المركبة أولاً');
  }

  return prisma.driverProfile.create({
    data: {
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
