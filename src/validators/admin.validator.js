const Joi = require('joi');

/**
 * التحقق من صحة سبب رفض الكابتن
 */
const rejectCaptainSchema = {
  body: Joi.object({
    reason: Joi.string().min(5).max(500).required().messages({
      'any.required': 'سبب الرفض مطلوب',
      'string.min': 'سبب الرفض يجب أن يكون على الأقل 5 أحرف',
      'string.max': 'سبب الرفض يجب أن لا يتجاوز 500 حرف',
    }),
  }),
};

const extendCaptainGracePeriodSchema = {
  body: Joi.object({
    extraDays: Joi.number().integer().min(1).required().messages({
      'any.required': 'عدد الأيام الإضافية مطلوب',
      'number.base': 'عدد الأيام الإضافية يجب أن يكون رقماً',
      'number.integer': 'عدد الأيام الإضافية يجب أن يكون رقماً صحيحاً',
      'number.min': 'يجب أن تكون مدة التمديد يوماً واحداً على الأقل',
    }),
  }),
};

module.exports = {
  rejectCaptainSchema,
  extendCaptainGracePeriodSchema,
};
