const Joi = require('joi');

const registerSchema = {
  body: Joi.object({
    phoneNumber: Joi.string()
      .pattern(/^\+?\d{10,15}$/)
      .required()
      .messages({
        'string.pattern.base': 'رقم الهاتف غير صحيح',
        'any.required': 'رقم الهاتف مطلوب',
      }),
    firstName: Joi.string().min(2).max(50).optional(),
    lastName: Joi.string().min(2).max(50).optional(),
  }),
};

const verifyOtpSchema = {
  body: Joi.object({
    phoneNumber: Joi.string()
      .pattern(/^\+?\d{10,15}$/)
      .required()
      .messages({
        'string.pattern.base': 'رقم الهاتف غير صحيح',
        'any.required': 'رقم الهاتف مطلوب',
      }),
    otp: Joi.string().length(4).required().messages({
      'string.length': 'كود التفعيل يجب أن يكون 4 أرقام',
      'any.required': 'كود التفعيل مطلوب',
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
      .valid('PRIVATE_CAR', 'TAXI', 'SCOOTER')
      .required()
      .messages({
        'any.only': 'نوع المركبة يجب أن يكون PRIVATE_CAR أو TAXI أو SCOOTER',
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
  }),
};

const firebaseLoginSchema = {
  body: Joi.object({
    firebaseIdToken: Joi.string().required().messages({
      'any.required': 'رمز Firebase مطلوب',
    }),
  }),
};

module.exports = { registerSchema, verifyOtpSchema, registerDriverSchema, firebaseLoginSchema };
