'use strict';

const Joi = require('joi');

const LINKEDIN_REGEX = /^https?:\/\/(www\.)?linkedin\.com\/.+/i;
const PHONE_REGEX = /^[+]?[\d\s\-()]{7,20}$/;

const submitTrainerApplicationSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'Enter your full name.',
    'string.min': 'Full name must be at least 2 characters.',
    'string.max': 'Full name cannot exceed 100 characters.',
    'any.required': 'Enter your full name.',
  }),

  email: Joi.string().trim().email().max(254).lowercase().required().messages({
    'string.empty': 'Enter your email address.',
    'string.email': 'Enter a valid email address.',
    'any.required': 'Enter your email address.',
  }),

  phone: Joi.string().trim().pattern(PHONE_REGEX).required().messages({
    'string.empty': 'Enter your mobile number.',
    'string.pattern.base': 'Enter a valid mobile number (7-20 digits, optional +, spaces or dashes).',
    'any.required': 'Enter your mobile number.',
  }),

  linkedinUrl: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .pattern(LINKEDIN_REGEX)
    .max(500)
    .required()
    .messages({
      'string.empty': 'Enter your LinkedIn profile URL.',
      'string.uri': 'Enter a valid LinkedIn URL (e.g. https://linkedin.com/in/yourname).',
      'string.pattern.base': 'Enter a valid LinkedIn profile URL (https://linkedin.com/in/...).',
      'any.required': 'Enter your LinkedIn profile URL.',
    }),

  organization: Joi.string().trim().min(2).max(120).required().messages({
    'string.empty': 'Enter your company or college name.',
    'string.min': 'Company or college name must be at least 2 characters.',
    'string.max': 'Company or college name cannot exceed 120 characters.',
    'any.required': 'Enter your company or college name.',
  }),

  domain: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'Select or enter your primary mentoring domain.',
    'string.min': 'Domain must be at least 2 characters.',
    'string.max': 'Domain cannot exceed 100 characters.',
    'any.required': 'Select or enter your primary mentoring domain.',
  }),

  experience: Joi.string().trim().min(1).max(50).required().messages({
    'string.empty': 'Enter or select your experience.',
    'string.max': 'Experience cannot exceed 50 characters.',
    'any.required': 'Enter or select your experience.',
  }),

  bio: Joi.string().trim().max(1500).allow('', null).optional().messages({
    'string.max': 'Bio cannot exceed 1500 characters.',
  }),

  // Invisible anti-spam honeypot field (must stay empty)
  website: Joi.string().allow('', null).optional(),
});

const acceptTrainerApplicationSchema = Joi.object({
  password: Joi.string().min(8).max(128).allow('', null).optional().messages({
    'string.min': 'Password must be at least 8 characters.',
    'string.max': 'Password cannot exceed 128 characters.',
  }),
  sendEmail: Joi.boolean().optional().default(true),
  domain: Joi.string().trim().min(2).max(100).allow('', null).optional(),
  experience: Joi.string().trim().min(1).max(50).allow('', null).optional(),
  organization: Joi.string().trim().min(2).max(120).allow('', null).optional(),
  bio: Joi.string().trim().max(1500).allow('', null).optional(),
  upgradeExistingUser: Joi.boolean().optional().default(false),
});

module.exports = {
  submitTrainerApplicationSchema,
  acceptTrainerApplicationSchema,
};
