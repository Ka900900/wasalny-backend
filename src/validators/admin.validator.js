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

module.exports = {
  rejectCaptainSchema,
};
