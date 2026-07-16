const { getProfile, updateProfile } = require('../services/user.service');

async function getProfileHandler(req, res) {
  try {
    const user = await getProfile(req.user.userId);
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: error.message || 'خطأ في جلب البيانات' });
  }
}

async function updateProfileHandler(req, res) {
  try {
    const user = await updateProfile(req.user.userId, req.body);
    res.json({ message: 'تم تحديث الملف الشخصي', user });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'خطأ في تحديث الملف الشخصي' });
  }
}

module.exports = { getProfileHandler, updateProfileHandler };
