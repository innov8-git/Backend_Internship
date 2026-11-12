'use strict';

const { registerSchema } = require('./register.dto');
const { loginSchema } = require('./login.dto');
const { forgotPasswordSchema } = require('./forgot-password.dto');
const { resetPasswordSchema } = require('./reset-password.dto');
const { refreshTokenSchema } = require('./refresh-token.dto');

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
};

