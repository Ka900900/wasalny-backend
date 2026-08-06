const Joi = require('joi');

const registerSchema = {
  body: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'البريد الإلكتروني غير صحيح',
      'any.required': 'البريد الإلكتروني مطلوب',
    }),
    password: Joi.string().min(6).max(128).required().messages({
      'string.min': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
      'string.max': 'كلمة المرور يجب أن تكون أقل من 128 حرف',
      'any.required': 'كلمة المرور مطلوبة',
    }),
    firstName: Joi.string().min(1).max(100).required().messages({
      'any.required': 'الاسم الأول مطلوب',
    }),
    lastName: Joi.string().min(1).max(100).required().messages({
      'any.required': 'الاسم الأخير مطلوب',
    }),
    phoneNumber: Joi.string()
      .pattern(/^(?:\+20|0)1\d{9}$/)
      .optional()
      .allow('', null)
      .messages({
        'string.pattern.base': 'رقم الهاتف المصري غير صحيح (مثال: 01xxxxxxxxx)',
      }),
  }),
};

const registerDriverSchema = {
  body: Joi.object({
    phoneNumber: Joi.string()
      .pattern(/^(?:\+20|0)1\d{9}$/)
      .required()
      .messages({
        'string.pattern.base': 'رقم الهاتف المصري غير صحيح (مثال: 01xxxxxxxxx)',
        'any.required': 'رقم الهاتف مطلوب',
      }),
    carModel: Joi.string().min(2).max(100).required().messages({
      'any.required': 'موديل السيارة مطلوب',
    }),
    carPlateNumber: Joi.string().min(3).max(20).required().messages({
      'any.required': 'رقم اللوحة مطلوب',
    }),
    carColor: Joi.string().min(2).max(50).required().messages({
      'any.required': 'لون السيارة مطلوب',
    }),
    vehicleType: Joi.string()
      .valid('PRIVATE_CAR', 'TAXI', 'SCOOTER', 'MOTORCYCLE')
      .required()
      .messages({
        'any.only': 'نوع المركبة يجب أن يكون PRIVATE_CAR أو TAXI أو SCOOTER أو MOTORCYCLE',
        'any.required': 'نوع المركبة مطلوب',
      }),
    carPhotoUrl: Joi.string()
      .uri()
      .pattern(/^https:\/\//)
      .required()
      .messages({
        'string.uri': 'رابط صورة السيارة غير صحيح',
        'string.pattern.base': 'رابط صورة السيارة يجب أن يبدأ بـ https://',
        'any.required': 'رابط صورة السيارة مطلوب',
      }),

    // ── حقول المستندات الاختيارية (الفلاتر بتبعتها) ──
    idPhotoFront:           Joi.string().uri().optional(),
    idPhotoBack:            Joi.string().uri().optional(),
    idCardBackUrl:          Joi.string().uri().optional(),
    licensePhoto:           Joi.string().uri().optional(),
    licenseBackUrl:         Joi.string().uri().optional(),
    facePhoto:              Joi.string().uri().optional(),
    insurancePhoto:         Joi.string().uri().optional(),
    vehicleLicenseFrontUrl: Joi.string().uri().optional(),
    vehicleLicenseBackUrl:  Joi.string().uri().optional(),
    serviceTier:            Joi.string().valid('ECO', 'COMFORT', 'PREMIUM').optional(),
    // توكن FCM ليُحفظ مباشرة مع تسجيل الكابتن (يُرسل بعد الحصول عليه)
    fcmToken:               Joi.string().min(10).max(512).optional().allow(''),
  }),
};

const firebaseLoginSchema = {
  body: Joi.object({
    firebaseIdToken: Joi.string().required().messages({
      'any.required': 'رمز Firebase مطلوب',
    }),
  }),
};

const loginSchema = {
  body: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'البريد الإلكتروني غير صحيح',
        'any.required': 'البريد الإلكتروني مطلوب',
      }),
    password: Joi.string()
      .required()
      .messages({
        'any.required': 'كلمة المرور مطلوبة',
      }),
  }),
};

const forgotPasswordSchema = {
  body: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'البريد الإلكتروني غير صحيح',
        'any.required': 'البريد الإلكتروني مطلوب',
      }),
  }),
};

const resetPasswordSchema = {
  body: Joi.object({
    // نقبل `code` أو `token` (كلاهما نفس المعنى: رمز إعادة التعيين)
    code: Joi.string().optional().allow(''),
    token: Joi.string().optional().allow(''),
    newPassword: Joi.string()
      .min(6)
      .max(128)
      .required()
      .messages({
        'string.min': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
        'string.max': 'كلمة المرور يجب أن تكون أقل من 128 حرف',
        'any.required': 'كلمة المرور الجديدة مطلوبة',
      }),
  })
    .custom((value, helpers) => {
      const raw = (value.code || value.token || '').trim();
      if (!raw) {
        return helpers.message('رمز إعادة التعيين مطلوب');
      }
      // توحيد الاسم إلى `code` بعد التحقق
      return { code: raw, newPassword: value.newPassword };
    }),
};

module.exports = {
  registerDriverSchema,
  firebaseLoginSchema,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
