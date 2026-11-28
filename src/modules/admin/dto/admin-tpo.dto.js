'use strict';

const Joi = require('joi');
const { TPO_COMMISSION_TYPE } = require('../../../common/constants');

const phonePattern = /^[+\d\s\-()]{7,20}$/;

const commissionTypeSchema = Joi.string()
  .valid(TPO_COMMISSION_TYPE.FIXED, TPO_COMMISSION_TYPE.PERCENTAGE)
  .messages({
    'any.only': 'Commission type must be FIXED or PERCENTAGE.',
  });

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

  commissionType: commissionTypeSchema.default(TPO_COMMISSION_TYPE.FIXED),

  commissionValue: Joi.number()
    .integer()
    .min(0)
    .when('commissionType', {
      is: TPO_COMMISSION_TYPE.PERCENTAGE,
      then: Joi.number().integer().min(0).max(10000).messages({
        'number.max': 'Commission percentage cannot exceed 100%.',
      }),
      otherwise: Joi.number().integer().min(0).max(10000000).messages({
        'number.max': 'Fixed commission cannot exceed ₹1,00,000 per student.',
      }),
    })
    .default(0)
    .messages({
      'number.base': 'Enter a valid commission value.',
      'number.min': 'Commission value cannot be negative.',
    }),

  portalEnabled: Joi.boolean().default(true),

  createPortalAccount: Joi.boolean().default(true),

  password: Joi.string().trim().min(8).max(72).allow('', null).messages({
    'string.min': 'Portal password must be at least 8 characters.',
    'string.max': 'Portal password cannot exceed 72 characters.',
  }),

  sendEmail: Joi.boolean().default(true),
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

  portalEnabled: Joi.boolean(),

  commissionType: commissionTypeSchema,

  commissionValue: Joi.number().integer().min(0).max(10000000).messages({
    'number.base': 'Enter a valid commission value.',
    'number.min': 'Commission value cannot be negative.',
  }),
})
  .min(1)
  .messages({
    'object.min': 'Provide at least one field to update.',
  });

const provisionTpoPortalSchema = Joi.object({
  password: Joi.string().trim().min(8).max(72).allow('', null).messages({
    'string.min': 'Portal password must be at least 8 characters.',
    'string.max': 'Portal password cannot exceed 72 characters.',
  }),
  sendEmail: Joi.boolean().default(true),
});

const recordTpoPayoutSchema = Joi.object({
  earningIds: Joi.array().items(Joi.string().uuid()).min(1).optional(),
  paymentMethod: Joi.string().trim().max(80).allow('', null).default('Bank Transfer / UPI'),
  transactionRef: Joi.string().trim().max(120).allow('', null),
  notes: Joi.string().trim().max(500).allow('', null),
  paidAt: Joi.date().iso().optional(),
});

module.exports = {
  createTpoSchema,
  updateTpoSchema,
  provisionTpoPortalSchema,
  recordTpoPayoutSchema,
};
