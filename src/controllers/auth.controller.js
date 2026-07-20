const authService = require("../services/auth.service");
const userRepository = require("../repositories/user.repository");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// 🔑 دالة تسجيل الدخول الشاملة
async function login(req, res, next) {
  try {
    const { email, password, idToken, displayName, photoUrl, phone, phoneNumber } = req.body;

    // 1️⃣ الحالة الأولى: تسجيل دخول عادي ببريد وباسورد
    if (email && password) {
      const cleanEmail = email.toLowerCase().trim();
      
      const user = await prisma.user.findFirst({ where: { email: cleanEmail } });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
        });
      }

      if (user.password) {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(400).json({
            success: false,
            message: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
          });
        }
      }

      const token = jwt.sign(
        { id: user.id, userId: user.id, role: user.role },
        process.env.JWT_SECRET || "secret_key",
        { expiresIn: "30d" }
      );

      return res.json({
        success: true,
        message: "تم تسجيل الدخول بنجاح",
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          role: user.role,
          avatarUrl: user.avatarUrl,
          isActive: user.isActive,
        },
      });
    }

    // 2️⃣ الحالة الثانية: استخدام idToken من Google عبر authService
    if (idToken && authService.login) {
      try {
        const result = await authService.login(idToken);
        return res.json(result);
      } catch (serviceErr) {
        console.warn("⚠️ فشل authService.login:", serviceErr.message);
      }
    }

    // 3️⃣ الحالة الثالثة: الدخول/المزامنة ببيانات جوجل مباشرة
    if (email || idToken) {
      const cleanEmail = email ? email.toLowerCase().trim() : null;

      if (!cleanEmail) {
        return res.status(400).json({
          success: false,
          message: "البريد الإلكتروني مطلوب لمزامنة حساب جوجل",
        });
      }

      const nameParts = (displayName || "").trim().split(" ");
      const firstName = nameParts[0] || "كابتن";
      const lastName = nameParts.slice(1).join(" ") || "";
      const userPhone = phoneNumber || phone || `010${Math.floor(10000000 + Math.random() * 90000000)}`;

      let user = await prisma.user.findFirst({ where: { email: cleanEmail } });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: cleanEmail,
            firstName,
            lastName,
            phoneNumber: userPhone,
            avatarUrl: photoUrl || null,
            role: "CAPTAIN", // 👈 للإنشاء الجديد
            isActive: true,
          },
        });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
         data: {
            firstName: user.firstName || firstName,
            lastName: user.lastName || lastName,
            avatarUrl: photoUrl || user.avatarUrl,
            role: "CAPTAIN", // 👈 تحويل الحساب الحالي تلقائياً لـ CAPTAIN
            isActive: true,
          },
        });
      }

      const token = jwt.sign(
        { id: user.id, userId: user.id, role: user.role },
        process.env.JWT_SECRET || "secret_key",
        { expiresIn: "30d" }
      );

      return res.json({
        success: true,
        message: "تم تسجيل الدخول وسحب البيانات الموثقة بنجاح",
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          role: user.role,
          avatarUrl: user.avatarUrl,
          isActive: user.isActive,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: "يرجى تقديم البريد الإلكتروني وكلمة المرور، أو idToken الخاص بجوجل",
    });

  } catch (error) {
    console.error("❌ Login Error Details:", error);
    return res.status(500).json({
      success: false,
      message: "خطأ في تنفيذ الطلب على قاعدة البيانات",
      errorDetails: error.message,
    });
  }
}

// ── تسجيل/تحديث FCM Token الخاص بالجهاز ──
async function registerFcmToken(req, res, next) {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { fcmToken } = req.body;
    
    if (typeof fcmToken !== "string" || fcmToken.trim() === "") {
      return res.status(400).json({ error: "fcmToken مطلوب" });
    }
    
    await userRepository.updateFcmToken(userId, fcmToken.trim());
    res.json({ success: true, message: "تم حفظ رمز الإشعارات" });
  } catch (error) {
    console.error("❌ registerFcmToken error:", error);
    next(error);
  }
}

module.exports = {
  login,
  registerFcmToken,
};