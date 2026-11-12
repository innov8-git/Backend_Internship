'use strict';

const Joi = require('joi');

const otpPattern = /^\d{6}$/;
const otpMessage = 'OTP must be exactly 6 digits.';

const sendOtpSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim().messages({
    'string.email': 'Please provide a valid email address.',
    'any.required': 'Email is required.',
  }),
  purpose: Joi.string()
    .valid('REGISTRATION_VERIFY', 'LOGIN', 'PASSWORD_RESET')
    .required()
    .messages({
      'any.only': 'Purpose must be REGISTRATION_VERIFY, LOGIN, or PASSWORD_RESET.',
      'any.required': 'Purpose is required.',
    }),
});

const verifyRegistrationOtpSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim().messages({
    'string.email': 'Please provide a valid email address.',
    'any.required': 'Email is required.',
  }),
  otp: Joi.string().pattern(otpPattern).required().messages({
    'string.pattern.base': otpMessage,
    'any.required': 'OTP is required.',
  }),
});

const loginOtpSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim().messages({
    'string.email': 'Please provide a valid email address.',
    'any.required': 'Email is required.',
  }),
  otp: Joi.string().pattern(otpPattern).required().messages({
    'string.pattern.base': otpMessage,
    'any.required': 'OTP is required.',
  }),
});

const verifyResetOtpSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim().messages({
    'string.email': 'Please provide a valid email address.',
    'any.required': 'Email is required.',
  }),
  otp: Joi.string().pattern(otpPattern).required().messages({
    'string.pattern.base': otpMessage,
    'any.required': 'OTP is required.',
  }),
});

module.exports = {
  sendOtpSchema,
  verifyRegistrationOtpSchema,
  loginOtpSchema,
  verifyResetOtpSchema,
};
