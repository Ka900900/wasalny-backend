const prisma = require('../config/prisma');
const { assertCanAcceptRides } = require('../config/wallet.constants');
const { createCaptainPendingNotification } = require('../services/notification.service');
const { calculateCaptainStatus } = require('../services/captain-status.service');

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
  // + DriverProfile.isAvailable === true
  // + status المحسوب ليس DOCS_EXPIRED (ولا_PENDING / REJECTED)
  // هذا يمنع إرسال إشعار رحلة جديدة لكابتن Offline / غير متاح / غير معتمد أو منتهي مهلة الأوراق.
  const users = await prisma.user.findMany({
    where: {
      role: 'DRIVER',
      isActive: true,
      fcmToken: { not: null },
      driverProfile: { is: { isAvailable: true } },
    },
    select: {
      id: true,
      fcmToken: true,
      createdAt: true,
      driverProfile: {
        select: {
          verificationStatus: true,
          gracePeriodEndDate: true,
          idPhotoFront: true,
          idPhotoBack: true,
          licensePhoto: true,
          facePhoto: true,
          insurancePhoto: true,
          idCardBackUrl: true,
          licenseBackUrl: true,
          vehicleLicenseFrontUrl: true,
          vehicleLicenseBackUrl: true,
          criminalRecordUrl: true,
          drugTestUrl: true,
        },
      },
    },
  });

  return users
    .filter((user) => user.driverProfile && calculateCaptainStatus({ ...user.driverProfile, user: { createdAt: user.createdAt } }) === 'APPROVED')
    .map((user) => ({ id: user.id, fcmToken: user.fcmToken }));
}

async function setDriverAvailability(userId, isAvailable) {
  // 1. التحقق من وجود DriverProfile مسبقاً
  const existingProfile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (existingProfile) {
    if (isAvailable && calculateCaptainStatus(existingProfile) === 'DOCS_EXPIRED') {
      const error = new Error('تم حظرك لعدم استكمال الأوراق خلال المهلة المحددة');
      error.code = 'DOCS_EXPIRED';
      throw error;
    }

    // ── حارس التوثيق: الكابتن المعلق/المرفوض لا يمكنه الظهور كمتاح ──
    if (isAvailable && existingProfile.verificationStatus !== 'APPROVED') {
      const stateLabel = existingProfile.verificationStatus === 'REJECTED' ? 'مرفوض' : 'قيد المراجعة';
      throw new Error(`لم يتم اعتماد حسابك بعد (الحالة: ${stateLabel}). يرجى الانتظار حتى تراجع الإدارة مستنداتك.`);
    }
    // حارس حد الدين: عند التفعيل (online) يُمنع إذا كان الرصيد عند حد الدين أو أقل
    if (isAvailable) {
      await assertCanAcceptRides(userId);
    }
    // الـ Profile موجود → تحديث حالة التوفر فقط
    return prisma.driverProfile.update({
      where: { userId },
      data: { isAvailable: !!isAvailable },
    });
  }

  if (isAvailable) {
    await assertCanAcceptRides(userId);
  }

  // 2. الـ Profile غير موجود → التحقق من وجود مركبة لإنشاء Profile جديد
  const vehicle = await prisma.vehicle.findFirst({ where: { userId } });
  if (!vehicle) {
    throw new Error('برجاء تسجيل بيانات المركبة أولاً');
  }

  const profile = await prisma.driverProfile.create({
    data: {
      userId,
      // الملف الجديد يبدأ بحالة PENDING → يبقى غير متاح حتى يتم اعتماده
      isAvailable: false,
      carModel: `${vehicle.make} ${vehicle.model}`,
      carColor: vehicle.color,
      carPlateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      carPhotoUrl: vehicle.licenseFrontUrl,
    },
  });

  // إشعار للأدمن بتسجيل كابتن جديد بانتظار المراجعة (لا يُفشل العملية عند الخطأ)
  createCaptainPendingNotification(userId, {
    type: 'CAPTAIN_PENDING',
    title: 'كابتن جديد بانتظار المراجعة',
    body: 'سجّل كابتن جديد بحالة "قيد المراجعة". راجع مستنداته للاعتماد.',
    link: '/captains',
  });

  return profile;
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
