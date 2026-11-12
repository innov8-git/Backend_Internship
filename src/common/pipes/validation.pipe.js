'use strict';

const { ApiError } = require('../../utils');

/**
 * Validation Pipe Middleware Factory
 * Validates request body, query, or params against a Joi schema.
 * Formats errors into the standardized details array: [{ field, message }]
 *
 * @param {import('joi').Schema} schema
 * @param {'body' | 'query' | 'params'} [source='body']
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const dataToValidate = req[source] || {};
    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false,
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/['"]/g, ''),
      }));
      return next(ApiError.validationError(details, 'Validation failed.'));
    }

    // Replace request data with sanitized/validated data
    req[source] = value;
    next();
  };
}

module.exports = { validate };

