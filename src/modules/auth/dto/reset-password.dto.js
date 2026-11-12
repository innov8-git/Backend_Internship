'use strict';

const Joi = require('joi');

const resetPasswordSchema = Joi.object({
  token: Joi.string().trim().required().messages({
    'string.empty': 'Reset token is required.',
    'any.required': 'Reset token is required.',
  }),

  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[A-Za-z])(?=.*\d)/)
    .required()
    .messages({
      'string.empty': 'Create a new password.',
      'string.min': 'Your password needs at least 8 characters.',
      'string.max': 'Use 128 characters or fewer.',
      'string.pattern.base': 'Your password needs at least one letter and one number.',
      'any.required': 'Create a new password.',
    }),
});

module.exports = { resetPasswordSchema };
