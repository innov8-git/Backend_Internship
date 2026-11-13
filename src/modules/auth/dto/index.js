'use strict';

const {
  registerSchema,
  registerStudentSchema,
  registerTrainerSchema,
} = require('./register.dto');
const { loginSchema } = require('./login.dto');
const { forgotPasswordSchema } = require('./forgot-password.dto');
const { resetPasswordSchema } = require('./reset-password.dto');
const { refreshTokenSchema } = require('./refresh-token.dto');
const {
  sendOtpSchema,
  verifyRegistrationOtpSchema,
  loginOtpSchema,
  verifyResetOtpSchema,
} = require('./otp.dto');

module.exports = {
  registerSchema,
  registerStudentSchema,
  registerTrainerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  sendOtpSchema,
  verifyRegistrationOtpSchema,
  loginOtpSchema,
  verifyResetOtpSchema,
};
