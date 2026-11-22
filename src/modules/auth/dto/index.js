'use strict';

const {
  registerSchema,
  registerStudentSchema,
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
const { updateMeSchema } = require('./update-me.dto');
const { googleLoginSchema } = require('./google-login.dto');

module.exports = {
  updateMeSchema,
  googleLoginSchema,
  registerSchema,
  registerStudentSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  sendOtpSchema,
  verifyRegistrationOtpSchema,
  loginOtpSchema,
  verifyResetOtpSchema,
};
