const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  toDto,
  ok,
  created,
  noContent,
  message,
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateRandomToken,
  setRefreshCookie,
  clearRefreshCookie,
} = require('../../utils');
const { USER_STATUS, ROLES } = require('../../common/constants');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../../libs/email');
const logger = require('../../libs/logger');

/**
 * User DTO — strips passwordHash and maps id → _id.
 */
function userDto(user) {
  if (!user) return null;
  return {
    _id: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    status: user.status,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createVerificationToken(userId) {
  const token = generateRandomToken();
  await prisma.authToken.create({
    data: {
      userId,
      type: 'EMAIL_VERIFY',
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    },
  });
  return token;
}

async function createPasswordResetToken(userId) {
  const token = generateRandomToken();
  // Invalidate old reset tokens
  await prisma.authToken.updateMany({
    where: { userId, type: 'PASSWORD_RESET', usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.authToken.create({
    data: {
      userId,
      type: 'PASSWORD_RESET',
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
  });
  return token;
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Validate
  const details = [];
  if (!name || name.trim().length < 2) {
    details.push({ field: 'name', message: 'Name must be at least 2 characters.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    details.push({ field: 'email', message: 'Enter a valid email address.' });
  }
  if (!password || password.length < 8) {
    details.push({ field: 'password', message: 'Password must be at least 8 characters.' });
  }
  if (details.length > 0) throw ApiError.validationError(details);

  // Check duplicate email
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) {
    throw ApiError.conflict('EMAIL_TAKEN', 'An account with this email already exists.', [
      { field: 'email', message: 'This email is already registered.' },
    ]);
  }

  // Create user
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      roles: [ROLES.STUDENT],
      status: USER_STATUS.PENDING_VERIFICATION,
      emailVerified: false,
    },
  });

  // Send verification email
  try {
    const token = await createVerificationToken(user.id);
    await sendVerificationEmail(user.email, user.name, token);
  } catch (err) {
    logger.warn('Failed to send verification email:', err.message);
  }

  created(res, userDto(user));
});

/**
 * POST /auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw ApiError.invalidCredentials();
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) throw ApiError.invalidCredentials();

  // Check suspended
  if (user.status === USER_STATUS.SUSPENDED) {
    throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended. Contact support.');
  }

  // Compare password
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw ApiError.invalidCredentials();

  // Generate tokens
  const accessToken = signAccessToken({ userId: user.id, roles: user.roles });
  const refreshToken = signRefreshToken({ userId: user.id });

  // Set refresh token cookie
  setRefreshCookie(res, refreshToken);

  ok(res, { accessToken, user: userDto(user) });
});

/**
 * POST /auth/refresh
 */
const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw ApiError.unauthorized('UNAUTHENTICATED', 'No refresh token provided.');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch (err) {
    clearRefreshCookie(res);
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('TOKEN_EXPIRED', 'Your session has expired. Please log in again.');
    }
    throw ApiError.unauthorized('UNAUTHENTICATED', 'Invalid refresh token.');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized('UNAUTHENTICATED', 'User not found.');
  }
  if (user.status === USER_STATUS.SUSPENDED) {
    clearRefreshCookie(res);
    throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended.');
  }

  // Issue new tokens
  const accessToken = signAccessToken({ userId: user.id, roles: user.roles });
  const newRefreshToken = signRefreshToken({ userId: user.id });
  setRefreshCookie(res, newRefreshToken);

  ok(res, { accessToken, user: userDto(user) });
});

/**
 * POST /auth/logout
 */
const logout = asyncHandler(async (_req, res) => {
  clearRefreshCookie(res);
  noContent(res);
});

/**
 * GET /auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  ok(res, userDto(req.user));
});

/**
 * PATCH /auth/me
 */
const updateMe = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) {
    throw ApiError.validationError([{ field: 'name', message: 'Name must be at least 2 characters.' }]);
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { name: name.trim() },
  });

  ok(res, userDto(user));
});

/**
 * POST /auth/verify-email
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) throw ApiError.badRequest('TOKEN_INVALID', 'Verification token is required.');

  const authToken = await prisma.authToken.findUnique({ where: { token } });

  if (!authToken || authToken.type !== 'EMAIL_VERIFY') {
    throw ApiError.badRequest('TOKEN_INVALID', 'Invalid verification token.');
  }
  if (authToken.usedAt) {
    throw ApiError.badRequest('TOKEN_INVALID', 'This token has already been used.');
  }
  if (new Date() > authToken.expiresAt) {
    throw ApiError.badRequest('TOKEN_EXPIRED', 'This verification link has expired. Request a new one.');
  }

  // Mark token as used and verify user
  await prisma.$transaction([
    prisma.authToken.update({ where: { id: authToken.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: authToken.userId },
      data: { emailVerified: true, status: USER_STATUS.ACTIVE },
    }),
  ]);

  message(res, 'Email verified successfully.');
});

/**
 * POST /auth/resend-verification
 */
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  // Always return same message to prevent email enumeration
  const genericMsg = 'If an account with that email exists, a verification email has been sent.';

  if (!email) return message(res, genericMsg);

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || user.emailVerified) return message(res, genericMsg);

  try {
    const token = await createVerificationToken(user.id);
    await sendVerificationEmail(user.email, user.name, token);
  } catch (err) {
    logger.warn('Failed to resend verification email:', err.message);
  }

  message(res, genericMsg);
});

/**
 * POST /auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const genericMsg = 'If an account with that email exists, a password reset email has been sent.';

  if (!email) return message(res, genericMsg);

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return message(res, genericMsg);

  try {
    const token = await createPasswordResetToken(user.id);
    await sendPasswordResetEmail(user.email, user.name, token);
  } catch (err) {
    logger.warn('Failed to send password reset email:', err.message);
  }

  message(res, genericMsg);
});

/**
 * POST /auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token) throw ApiError.badRequest('TOKEN_INVALID', 'Reset token is required.');
  if (!password || password.length < 8) {
    throw ApiError.validationError([{ field: 'password', message: 'Password must be at least 8 characters.' }]);
  }

  const authToken = await prisma.authToken.findUnique({ where: { token } });

  if (!authToken || authToken.type !== 'PASSWORD_RESET') {
    throw ApiError.badRequest('TOKEN_INVALID', 'Invalid reset token.');
  }
  if (authToken.usedAt) {
    throw ApiError.badRequest('TOKEN_INVALID', 'This token has already been used.');
  }
  if (new Date() > authToken.expiresAt) {
    throw ApiError.badRequest('TOKEN_EXPIRED', 'This reset link has expired. Request a new one.');
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.authToken.update({ where: { id: authToken.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: authToken.userId },
      data: { passwordHash },
    }),
  ]);

  message(res, 'Password reset successfully. You can now log in with your new password.');
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  getMe,
  updateMe,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
};
