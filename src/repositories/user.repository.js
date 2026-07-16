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
  // تحديث حالة توفّر الكابتن (متصل/غير متصل) في ملفه.
  // يُستخدم عند الفصل المفاجئ للسوكيت (App Kill / انقطاع الإنترنت).
  return prisma.driverProfile.update({
    where: { userId },
    data: { isAvailable: !!isAvailable },
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
