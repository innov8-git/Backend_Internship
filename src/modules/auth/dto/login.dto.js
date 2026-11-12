'use strict';

const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().trim().email().required().messages({
    'string.empty': 'Enter your email address.',
    'string.email': 'Enter a valid email address.',
    'any.required': 'Enter your email address.',
  }),

  password: Joi.string().required().messages({
    'string.empty': 'Enter your password.',
    'any.required': 'Enter your password.',
  }),
});

module.exports = { loginSchema };

