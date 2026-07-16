const Joi = require('joi');

const sosAlertSchema = {
  body: Joi.object({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    contacts: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().allow('').optional(),
          phone: Joi.string().min(8).max(20).required(),
        })
      )
      .min(1)
      .required(),
  }),
};

module.exports = { sosAlertSchema };
