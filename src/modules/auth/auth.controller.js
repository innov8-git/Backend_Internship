'use strict';

const path = require('path');
const multer = require('multer');
const authService = require('./services/auth.service');
const otpService = require('./services/otp.service');
const logger = require('../../libs/logger');
const { getStorage } = require('../../libs/storage');
const {
  RESUME_RULES,
  validateResumeFile,
} = require('../trainer-applications/trainer-applications.controller');
const {
  asyncHandler,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
  ok,
  created,
  ApiError,
} = require('../../utils');

const AVATAR_RULES = Object.freeze({
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  extToMime: {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  },
});

const avatarMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_RULES.maxFileSizeBytes, files: 1 },
});

function avatarUploadMiddleware(req, res, next) {
  avatarMulter.single('avatar')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Profile picture must be 5 MB or smaller.'
          : err.message || 'Invalid image upload.';
      return next(ApiError.validationError([{ field: 'avatar', message: msg }]));
    }
    return next(err);
  });
}

function hasValidImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // GIF: GIF8
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
  // WEBP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }
  return false;
}

function validateAvatarFile(file) {
  if (!file) {
    return { field: 'avatar', message: 'Please select an image file (PNG, JPG, WEBP, or GIF).' };
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext && !AVATAR_RULES.allowedExtensions.includes(ext)) {
    return { field: 'avatar', message: 'Upload a PNG, JPG, WEBP, or GIF image.' };
  }
  if (file.mimetype && !AVATAR_RULES.allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
    return { field: 'avatar', message: 'Unsupported image type. Upload PNG, JPG, WEBP, or GIF.' };
  }
  if (file.size > AVATAR_RULES.maxFileSizeBytes) {
    return { field: 'avatar', message: 'Profile picture must be 5 MB or smaller.' };
  }
  if (!hasValidImageSignature(file.buffer)) {
    return { field: 'avatar', message: 'The uploaded file is not a valid PNG, JPG, WEBP, or GIF image.' };
  }
  return null;
}

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
  logger.info(`[Login] Refresh token cookie set for user: ${user.email}`);

  return ok(res, { user, accessToken }, 'Login successful.');
});

/**
 * POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const rawRefreshToken = getRefreshTokenFromRequest(req);

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
  const rawRefreshToken = getRefreshTokenFromRequest(req);

  if (!rawRefreshToken) {
    logger.warn(`[Refresh] No valid refresh token found in cookies or body. Cookies present: ${Object.keys(req.cookies || {}).join(', ') || 'none'}`);
    throw ApiError.unauthorized('UNAUTHENTICATED', 'Refresh token required.');
  }

  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };

  const { user, accessToken, newRawRefreshToken } = await authService.refreshToken(rawRefreshToken, metadata);
  logger.info(`[Refresh] Token refreshed successfully for user: ${user.email}`);

  // Set updated rotated refresh cookie if a new token was generated
  if (newRawRefreshToken) {
    setRefreshTokenCookie(res, newRawRefreshToken);
  }

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
 * PATCH /api/v1/auth/me — update own profile
 */
const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateMe(req.user.id, req.body);
  return ok(res, user, 'Profile updated.');
});

/**
 * POST /api/v1/auth/me/avatar — upload profile picture to configured storage (Cloudinary)
 */
const uploadAvatar = asyncHandler(async (req, res) => {
  const fileError = validateAvatarFile(req.file);
  if (fileError) {
    throw ApiError.validationError([fileError]);
  }

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const effectiveMime = req.file.mimetype || AVATAR_RULES.extToMime[ext] || 'image/png';
  const storage = getStorage();
  const uploaded = await storage.upload(req.file.buffer, req.file.originalname, effectiveMime, {
    folder: 'avatars',
  });

  try {
    const user = await authService.setAvatarUrl(req.user.id, uploaded.url);
    return ok(res, user, 'Profile picture updated successfully.');
  } catch (err) {
    try {
      await storage.delete(uploaded.storageKey, uploaded.resourceType || 'image');
    } catch (cleanupErr) {
      logger.warn(`Failed to clean up orphaned avatar ${uploaded.storageKey}: ${cleanupErr.message}`);
    }
    throw err;
  }
});

/**
 * POST /api/v1/auth/me/resume — upload trainer resume to configured storage (Cloudinary)
 */
const uploadResume = asyncHandler(async (req, res) => {
  const fileError = validateResumeFile(req.file);
  if (fileError) {
    throw ApiError.validationError([fileError]);
  }

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const effectiveMime = RESUME_RULES.extToMime[ext] || req.file.mimetype || 'application/pdf';
  const storage = getStorage();
  const uploaded = await storage.upload(req.file.buffer, req.file.originalname, effectiveMime, {
    folder: 'resumes',
  });

  let result;
  try {
    result = await authService.setTrainerResume(req.user.id, {
      resumeUrl: uploaded.url,
      resumeKey: uploaded.storageKey,
      resumeName: uploaded.name,
      resumeMimeType: effectiveMime,
      resumeSize: uploaded.sizeBytes,
    });
  } catch (err) {
    try {
      await storage.delete(uploaded.storageKey, uploaded.resourceType || 'raw');
    } catch (cleanupErr) {
      logger.warn(`Failed to clean up orphaned resume ${uploaded.storageKey}: ${cleanupErr.message}`);
    }
    throw err;
  }

  if (result.previousResumeKey && result.previousResumeKey !== uploaded.storageKey) {
    try {
      await storage.delete(result.previousResumeKey, 'raw');
    } catch (err) {
      logger.warn(`Failed to delete previous trainer resume ${result.previousResumeKey}: ${err.message}`);
    }
  }

  return ok(res, result.user, 'Resume uploaded successfully.');
});

/**
 * POST /api/v1/auth/google — sign in / sign up with a Google ID token or code
 */
const loginWithGoogle = asyncHandler(async (req, res) => {
  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
  const { user, accessToken, rawRefreshToken } = await authService.loginWithGoogle(req.body, metadata);

  setRefreshTokenCookie(res, rawRefreshToken);
  logger.info(`[GoogleLogin] Refresh token cookie set for user: ${user.email}`);

  return ok(res, { user, accessToken }, 'Login successful.');
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
  login,
  logout,
  refresh,
  getMe,
  updateMe,
  avatarUploadMiddleware,
  uploadAvatar,
  uploadResume,
  loginWithGoogle,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  sendOtp,
  verifyRegistrationOtp,
  loginWithOtp,
  verifyResetOtp,
};
