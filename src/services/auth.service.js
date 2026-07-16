const { verifyFirebaseToken } = require("../config/firebase");
const userRepository = require("../repositories/user.repository");
const prisma = require("../config/prisma");

// يضمن وجود محفظة (برصيد 0) لأي مستخدم جديد لتفادي أخطاء 500 لاحقاً
async function ensureWallet(userId) {
  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId, balance: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
    });
  }
  return wallet;
}

async function login(idToken) {
  const decoded = await verifyFirebaseToken(idToken);
  let user = await userRepository.findByFirebaseUid(decoded.uid);
  if (!user) {
    user = await userRepository.createUser({
      firebaseUid: decoded.uid,
      phoneNumber: decoded.phone_number || "",
      email: decoded.email || null,
      firstName: "New",
      lastName: "User",
      isVerified: true,
    });
    // تهيئة المحفظة فور إنشاء المستخدم
    await ensureWallet(user.id);
  }
  await userRepository.updateLastLogin(user.id);
  return {
    success: true,
    user,
  };
}

module.exports = {
  login,
};
