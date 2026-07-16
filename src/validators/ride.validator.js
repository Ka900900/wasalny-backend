const Joi = require('joi');

const requestRideSchema = {
  body: Joi.object({
    rideType: Joi.string()
      .valid('economy', 'comfort', 'premium', 'xl')
      .optional(),
    pickupAddress: Joi.string().max(500).optional(),
    destinationAddress: Joi.string().max(500).optional(),
    pickupPoint: Joi.string().max(200).optional().default(''),
    dropoffPoint: Joi.string().max(200).optional().default(''),
    originLat: Joi.number().min(-90).max(90).required().messages({
      'any.required': 'خط العرض الأصلي مطلوب',
    }),
    originLng: Joi.number().min(-180).max(180).required().messages({
      'any.required': 'خط الطول الأصلي مطلوب',
    }),
    destLat: Joi.number().min(-90).max(90).required().messages({
      'any.required': 'خط العرض الوجهة مطلوب',
    }),
    destLng: Joi.number().min(-180).max(180).required().messages({
      'any.required': 'خط الطول الوجهة مطلوب',
    }),
    paymentMethod: Joi.string()
      .valid('cash', 'wallet', 'card')
      .optional()
      .default('cash'),
  }),
};

const updateLocationSchema = {
  body: Joi.object({
    lat: Joi.number().min(-90).max(90).required().messages({
      'any.required': 'خط العرض مطلوب',
    }),
    lng: Joi.number().min(-180).max(180).required().messages({
      'any.required': 'خط الطول مطلوب',
    }),
  }),
};

const rateRideSchema = {
  body: Joi.object({
    rideId: Joi.string().required().messages({
      'any.required': 'معرف الرحلة مطلوب',
    }),
    toUserId: Joi.string().required().messages({
      'any.required': 'معرف المستخدم المراد تقييمه مطلوب',
    }),
    rating: Joi.number().min(1).max(5).required().messages({
      'any.required': 'التقييم مطلوب',
      'number.min': 'التقييم يجب أن يكون بين 1 و 5',
      'number.max': 'التقييم يجب أن يكون بين 1 و 5',
    }),
    comment: Joi.string().max(500).optional().allow(''),
  }),
};

const toggleAvailabilitySchema = {
  body: Joi.object({
    isAvailable: Joi.boolean().required().messages({
      'any.required': 'حالة التوفر مطلوبة',
      'boolean.base': 'حالة التوفر يجب أن تكون true أو false',
    }),
  }),
};

module.exports = { requestRideSchema, updateLocationSchema, rateRideSchema, toggleAvailabilitySchema };
