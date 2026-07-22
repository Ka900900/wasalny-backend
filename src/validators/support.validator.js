const Joi = require('joi');

const createTicketSchema = {
  body: Joi.object({
    subject: Joi.string().min(3).max(200).required().messages({
      'any.required': 'عنوان التذكرة مطلوب',
      'string.min': 'عنوان التذكرة يجب أن يكون على الأقل 3 أحرف',
      'string.max': 'عنوان التذكرة يجب أن لا يتجاوز 200 حرف',
    }),
    rideId: Joi.string().optional().allow('').messages({
      'string.base': 'معرف الرحلة يجب أن يكون نصاً',
    }),
    message: Joi.string().min(1).max(2000).required().messages({
      'any.required': 'نص الرسالة مطلوب',
      'string.min': 'نص الرسالة يجب أن لا يكون فارغاً',
      'string.max': 'نص الرسالة يجب أن لا يتجاوز 2000 حرف',
    }),
  }),
};

const addTicketMessageSchema = {
  body: Joi.object({
    text: Joi.string().min(1).max(2000).required().messages({
      'any.required': 'نص الرسالة مطلوب',
      'string.min': 'نص الرسالة يجب أن لا يكون فارغاً',
      'string.max': 'نص الرسالة يجب أن لا يتجاوز 2000 حرف',
    }),
  }),
};

module.exports = { createTicketSchema, addTicketMessageSchema };
