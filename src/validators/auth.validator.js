const Joi = require('joi');

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
  }),
};

const firebaseLoginSchema = {
  body: Joi.object({
    firebaseIdToken: Joi.string().required().messages({
      'any.required': 'رمز Firebase مطلوب',
    }),
  }),
};

module.exports = { registerDriverSchema, firebaseLoginSchema };
