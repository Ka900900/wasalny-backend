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
    withdrawMethod: Joi.string()
      .valid('BANK', 'INSTAPAY')
      .optional()
      .default('BANK')
      .messages({
        'any.only': 'طريقة السحب يجب أن تكون BANK أو INSTAPAY',
      }),
    // ── الحقول الخاصة بالتحويل البنكي ──
    bankName: Joi.string().min(2).max(100).messages({
      'string.min': 'اسم البنك يجب أن يكون على الأقل حرفين',
      'string.max': 'اسم البنك يجب أن لا يتجاوز 100 حرف',
    }),
    bankAccount: Joi.string().min(5).max(50).messages({
      'string.min': 'رقم الحساب يجب أن يكون على الأقل 5 أرقام',
      'string.max': 'رقم الحساب يجب أن لا يتجاوز 50 حرفاً',
    }),
    accountHolder: Joi.string().min(2).max(100).messages({
      'string.min': 'اسم صاحب الحساب يجب أن يكون على الأقل حرفين',
      'string.max': 'اسم صاحب الحساب يجب أن لا يتجاوز 100 حرف',
    }),
    // ── الحقل الخاص بـ InstaPay ──
    instapayId: Joi.string()
      .min(3)
      .max(100)
      .pattern(/@/)
      .messages({
        'string.min': 'معرف InstaPay يجب أن لا يقل عن 3 أحرف',
        'string.max': 'معرف InstaPay يجب أن لا يتجاوز 100 حرف',
        'string.pattern.base': 'معرف InstaPay يجب أن يحتوي على @ (مثال: user@instapay)',
      }),
  })
    .custom((value, helpers) => {
      if (value.withdrawMethod === 'BANK') {
        if (!value.bankName) return helpers.message('اسم البنك مطلوب للتحويل البنكي');
        if (!value.bankAccount) return helpers.message('رقم الحساب مطلوب للتحويل البنكي');
        if (!value.accountHolder) return helpers.message('اسم صاحب الحساب مطلوب للتحويل البنكي');
      } else if (value.withdrawMethod === 'INSTAPAY') {
        if (!value.instapayId) return helpers.message('معرف InstaPay مطلوب');
      }
      return value;
    })
    .messages({
      'custom': 'بيانات غير مكتملة حسب طريقة السحب المختارة',
    }),
};

const topUpSchema = {
  body: Joi.object({
    amount: Joi.number().positive().required().messages({
      'any.required': 'المبلغ مطلوب',
      'number.positive': 'المبلغ يجب أن يكون أكبر من صفر',
    }),
    paymentMethod: Joi.string()
      .valid('card', 'vodafone_cash', 'instapay')
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
