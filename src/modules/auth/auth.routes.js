'use strict';

const { Router } = require('express');
const authController = require('./auth.controller');
const { authenticate } = require('../../common/guards');
const { createAuthLimiter, createLoginLimiter } = require('../../config/rate-limit.config');
const { validate } = require('../../common/pipes');
const {
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
} = require('./dto');

const router = Router();

// Public registration routes with validation & rate limiting
router.post(
  '/register/student',
  createAuthLimiter(),
  validate(registerStudentSchema),
  authController.registerStudent,
);

router.post(
  '/register/trainer',
  createAuthLimiter(),
  validate(registerTrainerSchema),
  authController.registerTrainer,
);

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

// ─── OTP Endpoints ────────────────────────────────────────────────────────────

router.post(
  '/otp/send',
  createAuthLimiter(),
  validate(sendOtpSchema),
  authController.sendOtp,
);

router.post(
  '/otp/resend',
  createAuthLimiter(),
  validate(sendOtpSchema),
  authController.sendOtp,
);

router.post(
  '/otp/verify-registration',
  createAuthLimiter(),
  validate(verifyRegistrationOtpSchema),
  authController.verifyRegistrationOtp,
);

router.post(
  '/otp/login',
  createLoginLimiter(),
  validate(loginOtpSchema),
  authController.loginWithOtp,
);

router.post(
  '/otp/verify-reset',
  createAuthLimiter(),
  validate(verifyResetOtpSchema),
  authController.verifyResetOtp,
);

// Protected routes
router.get(
  '/me',
  authenticate,
  authController.getMe,
);

module.exports = router;
