'use strict';

const { Router } = require('express');
const authController = require('./auth.controller');
const { authenticate } = require('../../common/guards');
const { createAuthLimiter, createLoginLimiter } = require('../../config/rate-limit.config');
const { validate } = require('../../common/pipes');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} = require('./dto');

const router = Router();

// Public routes with validation & rate limiting
router.post(
  '/register',
  createAuthLimiter(),
  validate(registerSchema),
  authController.register,
);

router.post(
  '/login',
  createLoginLimiter(),
  validate(loginSchema),
  authController.login,
);

router.post(
  '/logout',
  authController.logout,
);

router.post(
  '/refresh',
  validate(refreshTokenSchema),
  authController.refresh,
);

router.post(
  '/refresh-token',
  validate(refreshTokenSchema),
  authController.refresh,
);

router.post(
  '/forgot-password',
  createAuthLimiter(),
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);

router.post(
  '/reset-password',
  createAuthLimiter(),
  validate(resetPasswordSchema),
  authController.resetPassword,
);

router.get(
  '/verify-email/:token',
  authController.verifyEmail,
);

router.post(
  '/verify-email',
  authController.verifyEmail,
);

router.post(
  '/resend-verification',
  createAuthLimiter(),
  validate(forgotPasswordSchema),
  authController.resendVerification,
);

// Protected routes
router.get(
  '/me',
  authenticate,
  authController.getMe,
);

module.exports = router;
