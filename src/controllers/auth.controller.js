const authService = require("../services/auth.service");
const userRepository = require("../repositories/user.repository");

async function login(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "idToken is required",
      });
    }
    const result = await authService.login(idToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// ── تسجيل/تحديث FCM Token الخاص بالجهاز ──
async function registerFcmToken(req, res, next) {
  try {
    const userId = req.user.userId;
    const { fcmToken } = req.body;
    if (typeof fcmToken !== 'string' || fcmToken.trim() === '') {
      return res.status(400).json({ error: 'fcmToken مطلوب' });
    }
    await userRepository.updateFcmToken(userId, fcmToken.trim());
    res.json({ success: true, message: 'تم حفظ رمز الإشعارات' });
  } catch (error) {
    console.error('❌ registerFcmToken error:', error);
    next(error);
  }
}

module.exports = {
  login,
  registerFcmToken,
};
