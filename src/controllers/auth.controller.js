const authService = require("../services/auth.service");
const userRepository = require("../repositories/user.repository");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ── تسجيل مستخدم جديد (email + password) ─────────────────
async function register(req, res, next) {
  try {
    const { email, password, firstName, lastName, phoneNumber } = req.body;

    // 1️⃣ التحقق من عدم وجود البريد مسبقاً
    const cleanEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "البريد الإلكتروني مسجل بالفعل",
      });
    }

    // 2️⃣ تشفير كلمة المرور
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3️⃣ إنشاء المستخدم
    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        password: hashedPassword,
        firstName,
        lastName,
        phoneNumber: phoneNumber || null,
        role: "RIDER",
        isActive: true,
      },
    });

    // 4️⃣ إنشاء محفظة للمستخدم الجديد
    try {
      await prisma.wallet.create({
        data: { userId: user.id, balance: 0, pendingWithdraw: 0, totalEarned: 0, totalWithdrawn: 0 },
      });
    } catch (walletErr) {
      console.warn("⚠️ register: wallet creation skipped (may already exist):", walletErr.message);
    }

    // 5️⃣ إنشاء JWT token (نفس الـ payload الموجود عشان ما يتأثرش riderId)
    const token = jwt.sign(
      { id: user.id, userId: user.id, role: user.role },
      process.env.JWT_SECRET || "secret_key",
      { expiresIn: "30d" }
    );

    return res.status(201).json({
      success: true,
      message: "تم إنشاء الحساب بنجاح",
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.error("❌ Register Error:", error);
    return res.status(500).json({
      success: false,
      message: "خطأ في إنشاء الحساب",
      errorDetails: error.message,
    });
  }
}

// 🔑 دالة تسجيل الدخول الشاملة
async function login(req, res, next) {
  try {
    const { email, password, idToken, displayName, photoUrl, phone, phoneNumber, role } = req.body;

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

      if (!user.password) {
        return res.status(400).json({
          success: false,
          message: "هذا الحساب مسجل عبر وسيلة أخرى (يرجى استخدام تسجيل الدخول عبر Firebase)",
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
        });
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
            role: role || "RIDER", // 👈 الـ role من body أو RIDER افتراضياً
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
            role: role || "RIDER", // 👈 الـ role من body أو RIDER افتراضياً
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

// ── تحديث رقم الهاتف ──
async function updatePhoneNumber(req, res, next) {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { phoneNumber } = req.body;

    // 1️⃣ التحقق من وجود الرقم
    if (!phoneNumber || typeof phoneNumber !== "string") {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف مطلوب",
      });
    }

    // 2️⃣ تنظيف الرقم
    const cleaned = phoneNumber.trim();

    // 3️⃣ التحقق من الصيغة: 8-15 رقم، ممكن + في الأول
    const phoneRegex = /^\+?\d{8,15}$/;
    if (!phoneRegex.test(cleaned)) {
      return res.status(400).json({
        success: false,
        message: "صيغة رقم الهاتف غير صحيحة (8-15 رقم، أرقام فقط)"
      });
    }

    // 4️⃣ رفض الـ placeholder الخاص بـ Firebase
    if (cleaned.startsWith("firebase:")) {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف هذا غير صالح"
      });
    }

    // 5️⃣ تنفيذ التحديث عبر الـ service
    const updatedUser = await authService.updatePhoneNumber(userId, cleaned);

    return res.json({
      success: true,
      message: "تم تحديث رقم الهاتف بنجاح",
      user: updatedUser,
    });
  } catch (error) {
    // 6️⃣ التقاط خطأ Prisma unique constraint (P2002)
    if (error.code === "P2002") {
      const target = error.meta?.target;
      if (Array.isArray(target) && target.includes("phoneNumber")) {
        return res.status(409).json({
          success: false,
          message: "رقم الهاتف مستخدم بالفعل من حساب آخر"
        });
      }
      return res.status(409).json({
        success: false,
        message: "القيمة المدخلة مستخدمة بالفعل من حساب آخر"
      });
    }

    console.error("❌ updatePhoneNumber error:", error);
    return res.status(500).json({
      success: false,
      message: "خطأ في تحديث رقم الهاتف",
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
//  نسيت كلمة المرور / إعادة تعيينها
// ════════════════════════════════════════════════════════════════════════

// توليد رمز مكوّن من 6 أرقام (يعمل كـ reset token)
function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// توصيل الرمز للمستخدم (بريد/رسالة) — حالياً يُطبع في سجل السيرفر فقط لعدم
// وجود مزوّد بريد في المشروع. اربط هنا nodemailer / SendGrid عند التفعيل.
function _deliverResetCode(user, code) {
  // TODO: أرسل الرمز عبر البريد الإلكتروني (nodemailer / SendGrid) أو SMS
  console.log(`🔑 Password reset code for ${user.email}: ${code}`);
}

// ── طلب رمز إعادة تعيين كلمة المرور ──
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const cleanEmail = email.toLowerCase().trim();
    const user = await prisma.user.findFirst({ where: { email: cleanEmail } });

    // نرجّع نجاح دائماً حتى لو لم يوجد البريد (لمنع كشف وجود الحسابات)
    if (!user) {
      return res.json({
        success: true,
        message: "إذا كان البريد مسجلاً، سيصلك رمز إعادة التعيين",
      });
    }

    const code = generateResetCode();
    const salt = await bcrypt.genSalt(10);
    const hashedCode = await bcrypt.hash(code, salt);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // صالح 15 دقيقة

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedCode,
        resetPasswordExpiresAt: expiresAt,
      },
    });

    _deliverResetCode(user, code);

    const isProduction = process.env.NODE_ENV === "production";
    return res.json({
      success: true,
      message: "تم إرسال رمز إعادة تعيين كلمة المرور إلى بريدك",
      expiresInMinutes: 15,
      // في بيئة التطوير فقط نرجّع الكود في الرد حتى يعمل تطبيق Flutter
      // أثناء التطوير (لعدم وجود مزوّد بريد). في الإنتاج يُرسل بريدياً فقط.
      ...(isProduction ? {} : { devCode: code }),
    });
  } catch (error) {
    console.error("❌ forgotPassword error:", error);
    return res.status(500).json({
      success: false,
      message: "خطأ في إرسال رمز إعادة التعيين",
      errorDetails: error.message,
    });
  }
}

// ── تنفيذ إعادة تعيين كلمة المرور ──
async function resetPassword(req, res, next) {
  try {
    const code = (req.body.code || req.body.token || "").trim();
    const { newPassword } = req.body;

    const now = new Date();
    const candidates = await prisma.user.findMany({
      where: {
        resetPasswordToken: { not: null },
        resetPasswordExpiresAt: { gt: now },
      },
    });

    // الرمز مخزّن مشفّراً (bcrypt)، لذا نقارن مع كل مستخدم لديه رمز ساري
    let matched = null;
    for (const u of candidates) {
      const ok = await bcrypt.compare(code, u.resetPasswordToken);
      if (ok) {
        matched = u;
        break;
      }
    }

    if (!matched) {
      return res.status(400).json({
        success: false,
        message: "رمز إعادة التعيين غير صحيح أو منتهي الصلاحية",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: matched.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpiresAt: null,
      },
    });

    return res.json({
      success: true,
      message: "تم تحديث كلمة المرور بنجاح، يمكنك تسجيل الدخول الآن",
    });
  } catch (error) {
    console.error("❌ resetPassword error:", error);
    return res.status(500).json({
      success: false,
      message: "خطأ في تحديث كلمة المرور",
      errorDetails: error.message,
    });
  }
}

module.exports = {
  login,
  register,
  registerFcmToken,
  updatePhoneNumber,
  forgotPassword,
  resetPassword,
};