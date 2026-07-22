const prisma = require('../config/prisma');

async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phoneNumber: true,
      firstName: true,
      lastName: true,
      role: true,
      isVerified: true,
      avatarUrl: true,
      createdAt: true,
      driverProfile: true,
      wallet: { select: { balance: true } },
    },
  });
  if (!user) {
    throw new Error('المستخدم غير موجود');
  }
  return user;
}

async function updateProfile(userId, { firstName, lastName, avatarUrl }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(avatarUrl && { avatarUrl }),
    },
    select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true },
  });
  return user;
}

/**
 * Delete a user account and all cascade-related data.
 * Cascading deletes (via Prisma schema):
 *   - RideRequest (as rider)     → Cascade
 *   - RideRequest (as driver)    → SetNull (rides preserved, driverId cleared)
 *   - DriverProfile              → Cascade
 *   - Rating (given & received)  → Cascade
 *   - Wallet                     → Cascade
 *   - SupportTicket              → Cascade
 *   - SupportMessage             → Cascade
 *   - Message (sent & received)  → Cascade
 *   - RideMessage (sent)         → Cascade
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function deleteAccount(userId) {
  // Check for active rides first — prevent deletion during an active trip
  const activeRide = await prisma.rideRequest.findFirst({
    where: {
      OR: [{ riderId: userId }, { driverId: userId }],
      status: { in: ['PENDING', 'ACCEPTED', 'STARTED'] },
    },
  });

  if (activeRide) {
    throw new Error('لا يمكن حذف الحساب أثناء وجود رحلة نشطة');
  }

  // Hard delete — schema cascades handle related records automatically
  await prisma.user.delete({ where: { id: userId } });
}

module.exports = { getProfile, updateProfile, deleteAccount };
