const { getProfile, updateProfile, deleteAccount } = require('../services/user.service');

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

async function deleteAccountHandler(req, res) {
  try {
    await deleteAccount(req.user.userId);
    res.json({ success: true, message: 'تم حذف الحساب بنجاح' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, error: error.message || 'خطأ في حذف الحساب' });
  }
}

module.exports = { getProfileHandler, updateProfileHandler, deleteAccountHandler };
