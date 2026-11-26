'use strict';

const Joi = require('joi');

const phonePattern = /^[+\d\s\-()]{7,20}$/;

const createTpoSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'Enter TPO full name.',
    'string.min': 'TPO name must be at least 2 characters.',
    'string.max': 'TPO name cannot exceed 100 characters.',
    'any.required': 'Enter TPO full name.',
  }),

  college: Joi.string().trim().min(2).max(160).required().messages({
    'string.empty': 'Enter college or institution name.',
    'string.min': 'College name must be at least 2 characters.',
    'string.max': 'College name cannot exceed 160 characters.',
    'any.required': 'Enter college or institution name.',
  }),

  email: Joi.string().trim().email().max(254).lowercase().required().messages({
    'string.empty': 'Enter TPO email address.',
    'string.email': 'Enter a valid email address.',
    'string.max': 'Email address is too long.',
    'any.required': 'Enter TPO email address.',
  }),

  phone: Joi.string().trim().min(7).max(20).pattern(phonePattern).required().messages({
    'string.empty': 'Enter TPO phone number.',
    'string.min': 'Phone number must be at least 7 digits.',
    'string.max': 'Phone number cannot exceed 20 characters.',
    'string.pattern.base': 'Enter a valid phone number (digits, spaces, +, -, parentheses).',
    'any.required': 'Enter TPO phone number.',
  }),
});

const updateTpoSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).messages({
    'string.empty': 'TPO name cannot be empty.',
    'string.min': 'TPO name must be at least 2 characters.',
    'string.max': 'TPO name cannot exceed 100 characters.',
  }),

  college: Joi.string().trim().min(2).max(160).messages({
    'string.empty': 'College name cannot be empty.',
    'string.min': 'College name must be at least 2 characters.',
    'string.max': 'College name cannot exceed 160 characters.',
  }),

  email: Joi.string().trim().email().max(254).lowercase().messages({
    'string.empty': 'Email address cannot be empty.',
    'string.email': 'Enter a valid email address.',
    'string.max': 'Email address is too long.',
  }),

  phone: Joi.string().trim().min(7).max(20).pattern(phonePattern).messages({
    'string.empty': 'Phone number cannot be empty.',
    'string.min': 'Phone number must be at least 7 digits.',
    'string.max': 'Phone number cannot exceed 20 characters.',
    'string.pattern.base': 'Enter a valid phone number (digits, spaces, +, -, parentheses).',
  }),

  isActive: Joi.boolean(),
})
  .min(1)
  .messages({
    'object.min': 'Provide at least one field to update.',
  });

module.exports = {
  createTpoSchema,
  updateTpoSchema,
};
