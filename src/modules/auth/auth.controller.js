'use strict';

const authService = require('./services/auth.service');
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
 * Delegates business logic to AuthService and formats HTTP responses.
 */

/**
 * POST /api/v1/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return created(res, user, 'Registration successful. Please check your email to verify your account.');
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

module.exports = {
  register,
  login,
  logout,
  refresh,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
};
