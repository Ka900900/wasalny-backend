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

module.exports = { getProfile, updateProfile };
