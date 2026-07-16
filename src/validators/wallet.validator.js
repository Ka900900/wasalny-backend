const Joi = require('joi');

// حدود السحب (بالجنيه المصري)
const MIN_WITHDRAW_AMOUNT = 50;    // الحد الأدنى للسحب
const MAX_WITHDRAW_AMOUNT = 10000; // الحد الأقصى للسحب

const withdrawSchema = {
  body: Joi.object({
    amount: Joi.number()
      .positive()
      .min(MIN_WITHDRAW_AMOUNT)
      .max(MAX_WITHDRAW_AMOUNT)
      .required()
      .messages({
        'any.required': 'المبلغ مطلوب',
        'number.positive': 'المبلغ يجب أن يكون أكبر من صفر',
        'number.min': 'المبلغ أقل من الحد الأدنى المسموح به للسحب',
        'number.max': 'المبلغ يتجاوز الحد الأقصى المسموح به للسحب',
      }),
    bankName: Joi.string().min(2).max(100).required().messages({
      'any.required': 'اسم البنك مطلوب',
    }),
    bankAccount: Joi.string().min(5).max(50).required().messages({
      'any.required': 'رقم الحساب مطلوب',
    }),
    accountHolder: Joi.string().min(2).max(100).required().messages({
      'any.required': 'اسم صاحب الحساب مطلوب',
    }),
  }),
};

const topUpSchema = {
  body: Joi.object({
    amount: Joi.number().positive().required().messages({
      'any.required': 'المبلغ مطلوب',
      'number.positive': 'المبلغ يجب أن يكون أكبر من صفر',
    }),
    paymentMethod: Joi.string()
      .valid('card', 'wallet')
      .optional()
      .default('card'),
  }),
};

const adminRejectWithdrawSchema = {
  body: Joi.object({
    rejectReason: Joi.string().min(2).max(255).optional(),
  }),
};

module.exports = { withdrawSchema, topUpSchema, rejectWithdrawalSchema: adminRejectWithdrawSchema };
