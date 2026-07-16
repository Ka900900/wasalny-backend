const { verifyFirebaseToken } = require("../config/firebase");
const userRepository = require("../repositories/user.repository");

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
