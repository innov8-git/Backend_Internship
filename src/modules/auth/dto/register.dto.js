'use strict';

const Joi = require('joi');

const baseUserFields = {
  name: Joi.string().trim().min(2).max(80).required().messages({
    'string.empty': 'Enter your full name.',
    'string.min': 'Your name needs at least 2 characters.',
    'string.max': 'Your name cannot exceed 80 characters.',
    'any.required': 'Enter your full name.',
  }),

  email: Joi.string().trim().email().max(254).lowercase().required().messages({
    'string.empty': 'Enter your email address.',
    'string.email': 'Enter a valid email address.',
    'string.max': 'This email address is too long.',
    'any.required': 'Enter your email address.',
  }),

  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[A-Za-z])(?=.*\d)/)
    .required()
    .messages({
      'string.empty': 'Create a password.',
      'string.min': 'Your password needs at least 8 characters.',
      'string.max': 'Use 128 characters or fewer.',
      'string.pattern.base': 'Your password needs at least one letter and one number.',
      'any.required': 'Create a password.',
    }),

  referralCode: Joi.string().trim().max(32).allow('', null).optional().messages({
    'string.max': 'Reference code is too long.',
  }),
};

// 1. Dedicated Student Registration Schema
const registerStudentSchema = Joi.object({
  ...baseUserFields,
});

// 2. Combined / Unified Registration Schema (Student Only)
const registerSchema = Joi.object({
  ...baseUserFields,
  role: Joi.string().valid('STUDENT').default('STUDENT').messages({
    'any.only': 'Public registration is only available for Students.',
  }),
});

module.exports = {
  registerSchema,
  registerStudentSchema,
};
