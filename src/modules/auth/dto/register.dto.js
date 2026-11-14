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
};

// 1. Dedicated Student Registration Schema
const registerStudentSchema = Joi.object({
  ...baseUserFields,
});

// 2. Dedicated Trainer Registration Schema
const registerTrainerSchema = Joi.object({
  ...baseUserFields,
  domain: Joi.string().trim().min(2).max(100).required().messages({
    'any.required': 'Select your primary mentoring domain.',
    'string.empty': 'Select your primary mentoring domain.',
  }),
  experience: Joi.string().trim().required().messages({
    'any.required': 'Select your years of experience.',
    'string.empty': 'Select your years of experience.',
  }),
  linkedinUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).allow('', null).optional().messages({
    'string.uri': 'Enter a valid URL (e.g. https://linkedin.com/in/username).',
  }),
  organization: Joi.string().trim().max(100).allow('', null).optional(),
  resumeUrl: Joi.string().trim().allow('', null).optional(),
});

// 3. Combined / Unified Registration Schema (Backward Compatible)
const registerSchema = Joi.object({
  ...baseUserFields,

  role: Joi.string().valid('STUDENT', 'TRAINER').default('STUDENT').messages({
    'any.only': 'Role must be either STUDENT or TRAINER.',
  }),

  domain: Joi.when('role', {
    is: 'TRAINER',
    then: Joi.string().trim().min(2).max(100).required().messages({
      'any.required': 'Select your primary mentoring domain.',
      'string.empty': 'Select your primary mentoring domain.',
    }),
    otherwise: Joi.string().trim().allow('', null).optional(),
  }),

  experience: Joi.when('role', {
    is: 'TRAINER',
    then: Joi.string().trim().required().messages({
      'any.required': 'Select your years of experience.',
      'string.empty': 'Select your years of experience.',
    }),
    otherwise: Joi.string().trim().allow('', null).optional(),
  }),

  linkedinUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).allow('', null).optional().messages({
    'string.uri': 'Enter a valid URL (e.g. https://linkedin.com/in/username).',
  }),

  organization: Joi.string().trim().max(100).allow('', null).optional(),

  resumeUrl: Joi.string().trim().allow('', null).optional(),
});

module.exports = {
  registerSchema,
  registerStudentSchema,
  registerTrainerSchema,
};
