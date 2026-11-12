'use strict';

const Joi = require('joi');

const forgotPasswordSchema = Joi.object({
  email: Joi.string().trim().email().required().messages({
    'string.empty': 'Enter your email address.',
    'string.email': 'Enter a valid email address.',
    'any.required': 'Enter your email address.',
  }),
});

module.exports = { forgotPasswordSchema };

