'use strict';

const Joi = require('joi');

const createTrainerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required().messages({
    'string.empty': 'Enter trainer full name.',
    'string.min': 'Name needs at least 2 characters.',
    'string.max': 'Name cannot exceed 80 characters.',
    'any.required': 'Enter trainer full name.',
  }),

  email: Joi.string().trim().email().max(254).lowercase().required().messages({
    'string.empty': 'Enter trainer email address.',
    'string.email': 'Enter a valid email address.',
    'any.required': 'Enter trainer email address.',
  }),

  phone: Joi.string().trim().max(20).allow('', null).optional(),

  password: Joi.string().min(8).max(128).allow('', null).optional().messages({
    'string.min': 'Password must be at least 8 characters if specified.',
    'string.max': 'Password cannot exceed 128 characters.',
  }),

  domain: Joi.string().trim().max(100).allow('', null).optional(),

  experience: Joi.string().trim().max(50).allow('', null).optional(),

  bio: Joi.string().trim().max(1000).allow('', null).optional(),
});

const updateTrainerPrivilegeSchema = Joi.object({
  isTrainer: Joi.boolean().required().messages({
    'any.required': 'isTrainer boolean is required.',
  }),
});

module.exports = {
  createTrainerSchema,
  updateTrainerPrivilegeSchema,
};

