'use strict';

const authService = require('./services/auth.service');
const otpService = require('./services/otp.service');
const {
  asyncHandler,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_NAME,
  ok,
  created,
  ApiError,
} = require('../../utils');

/**
 * Authentication Controller
 * Delegates business logic to AuthService and OtpService, formatting HTTP responses.
 */

/**
 * POST /api/v1/auth/register (Unified Endpoint)
 */
const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return created(res, user, 'Registration successful. A verification OTP has been sent to your email.');
});

/**
 * POST /api/v1/auth/register/student (Dedicated Student Endpoint)
 */
const registerStudent = asyncHandler(async (req, res) => {
  req.body.role = 'STUDENT';
  const user = await authService.register(req.body);
  return created(res, user, 'Student registration successful. A verification OTP has been sent to your email.');
});

/**
 * POST /api/v1/auth/register/trainer (Dedicated Trainer Endpoint)
 */
const registerTrainer = asyncHandler(async (req, res) => {
  req.body.role = 'TRAINER';
  const user = await authService.register(req.body);
  return created(res, user, 'Trainer application submitted for review. A verification OTP has been sent to your email.');
});

/**
 * POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };

  const { user, accessToken, rawRefreshToken } = await authService.login(email, password, metadata);

  // Set secure, httpOnly refresh cookie
  setRefreshTokenCookie(res, rawRefreshToken);

  return ok(res, { user, accessToken }, 'Login successful.');
});

/**
 * POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || req.body?.refreshToken;

  if (rawRefreshToken) {
    await authService.logout(rawRefreshToken);
  }

  clearRefreshTokenCookie(res);
  return ok(res, null, 'Logged out successfully.');
});

/**
 * POST /api/v1/auth/refresh (or /refresh-token)
 */
const refresh = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || req.body?.refreshToken;

  if (!rawRefreshToken) {
    throw ApiError.unauthorized('UNAUTHENTICATED', 'Refresh token required.');
  }

  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };

  const { user, accessToken, newRawRefreshToken } = await authService.refreshToken(rawRefreshToken, metadata);

  // Set updated rotated refresh cookie
  setRefreshTokenCookie(res, newRawRefreshToken);

  return ok(res, { user, accessToken }, 'Token refreshed successfully.');
});

/**
 * GET /api/v1/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  return ok(res, user);
});

/**
 * POST /api/v1/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.forgotPassword(email);
  return ok(res, null, result.message);
});

/**
 * POST /api/v1/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const result = await authService.resetPassword(token, password);
  return ok(res, null, result.message);
});

/**
 * GET or POST /api/v1/auth/verify-email
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const token = req.params?.token || req.query?.token || req.body?.token;
  const result = await authService.verifyEmail(token);
  return ok(res, null, result.message);
});

/**
 * POST /api/v1/auth/resend-verification
 */
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.resendVerification(email);
  return ok(res, null, result.message);
});

// ─── OTP Handlers ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/otp/send
 */
const sendOtp = asyncHandler(async (req, res) => {
  const { email, purpose } = req.body;
  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };

  const result = await otpService.generateAndSendOtp({ email, purpose, ...metadata });
  return ok(res, result, result.message);
});

/**
 * POST /api/v1/auth/otp/verify-registration
 */
const verifyRegistrationOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };

  const { user, accessToken, rawRefreshToken } = await otpService.verifyRegistration({
    email,
    otp,
    ...metadata,
  });

  setRefreshTokenCookie(res, rawRefreshToken);
  return ok(res, { user, accessToken }, 'Email verified successfully.');
});

/**
 * POST /api/v1/auth/otp/login
 */
const loginWithOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };

  const { user, accessToken, rawRefreshToken } = await otpService.loginWithOtp({
    email,
    otp,
    ...metadata,
  });

  setRefreshTokenCookie(res, rawRefreshToken);
  return ok(res, { user, accessToken }, 'Login successful.');
});

/**
 * POST /api/v1/auth/otp/verify-reset
 */
const verifyResetOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const result = await otpService.verifyResetOtp({ email, otp });
  return ok(res, result, result.message);
});

module.exports = {
  register,
  registerStudent,
  registerTrainer,
  login,
  logout,
  refresh,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  sendOtp,
  verifyRegistrationOtp,
  loginWithOtp,
  verifyResetOtp,
};
