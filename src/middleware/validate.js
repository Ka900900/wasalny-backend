/**
 * Joi validation middleware factory.
 * @param {object} schema - Joi schema object (body, params, query)
 * @returns {function} Express middleware
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = {};

    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        errors.body = error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        }));
      } else {
        req.body = value;
      }
    }

    if (schema.params) {
      const { error, value } = schema.params.validate(req.params, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        errors.params = error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        }));
      } else {
        req.params = value;
      }
    }

    if (schema.query) {
      const { error, value } = schema.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        errors.query = error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        }));
      } else {
        req.query = value;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'بيانات غير صحيحة',
        details: errors,
      });
    }

    next();
  };
}

module.exports = { validate };
