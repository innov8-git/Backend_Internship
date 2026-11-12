'use strict';

const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../../../database');
const {
  generateAccessToken,
  generateRefreshToken,
  generateRandomToken,
  hashToken,
  ApiError,
} = require('../../../utils');

/**
 * Token Service — Refresh Token Rotation, Session Tracking & Theft Detection
 */
class TokenService {
  /**
   * Create and persist a new refresh token family in database.
   * @param {string} userId
   * @param {{ userAgent?: string, ipAddress?: string }} metadata
   * @returns {Promise<{ rawRefreshToken: string, accessToken: string }>}
   */
  async createSession(user, metadata = {}) {
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const family = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.token.create({
      data: {
        userId: user.id,
        tokenHash,
        type: 'REFRESH',
        family,
        expiresAt,
        userAgent: metadata.userAgent || null,
        ipAddress: metadata.ipAddress || null,
      },
    });

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      roles: user.roles || [],
    });

    return {
      accessToken,
      rawRefreshToken,
    };
  }

  /**
   * Rotate a refresh token with strict reuse / theft detection.
   * @param {string} rawRefreshToken
   * @param {{ userAgent?: string, ipAddress?: string }} metadata
   * @returns {Promise<{ accessToken: string, newRawRefreshToken: string, user: object }>}
   */
  async rotateRefreshToken(rawRefreshToken, metadata = {}) {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw ApiError.unauthorized('UNAUTHENTICATED', 'Refresh token required.');
    }

    const tokenHash = hashToken(rawRefreshToken);

    const existingToken = await prisma.token.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Token not found
    if (!existingToken || existingToken.type !== 'REFRESH') {
      throw ApiError.unauthorized('UNAUTHENTICATED', 'Invalid refresh token.');
    }

    // THEFT / REUSE DETECTION:
    // If a previously revoked/used token is submitted again, someone stolen it!
    // Invalidate the entire family to protect the user.
    if (existingToken.revoked) {
      if (existingToken.family) {
        await prisma.token.updateMany({
          where: { family: existingToken.family },
          data: { revoked: true },
        });
      }
      throw ApiError.unauthorized(
        'SESSION_REVOKED',
        'Suspicious activity detected. All active sessions have been invalidated. Please log in again.',
      );
    }

    // Check expiration
    if (new Date() > new Date(existingToken.expiresAt)) {
      await prisma.token.update({
        where: { id: existingToken.id },
        data: { revoked: true },
      });
      throw ApiError.unauthorized('TOKEN_EXPIRED', 'Refresh token has expired. Please log in again.');
    }

    // Check user status
    const user = existingToken.user;
    if (!user || user.status === 'SUSPENDED') {
      throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Account suspended.');
    }

    // Mark current token as revoked and used
    await prisma.token.update({
      where: { id: existingToken.id },
      data: {
        revoked: true,
        usedAt: new Date(),
      },
    });

    // Issue new refresh token within the same family
    const newRawRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.token.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        type: 'REFRESH',
        family: existingToken.family,
        expiresAt: newExpiresAt,
        userAgent: metadata.userAgent || null,
        ipAddress: metadata.ipAddress || null,
      },
    });

    // Extract roles and permissions
    const roles = [];
    const permissionSet = new Set();
    for (const ur of user.userRoles || []) {
      if (ur.role) {
        roles.push(ur.role.name);
        for (const rp of ur.role.rolePermissions || []) {
          if (rp.permission?.code) permissionSet.add(rp.permission.code);
        }
      }
    }

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      roles,
    });

    return {
      accessToken,
      newRawRefreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        emailVerified: user.emailVerified,
        roles,
        permissions: Array.from(permissionSet),
      },
    };
  }

  /**
   * Revoke a single refresh token (on logout).
   * @param {string} rawRefreshToken
   */
  async revokeRefreshToken(rawRefreshToken) {
    if (!rawRefreshToken) return;
    try {
      const tokenHash = hashToken(rawRefreshToken);
      await prisma.token.updateMany({
        where: { tokenHash },
        data: { revoked: true, usedAt: new Date() },
      });
    } catch {
      // Ignore if not found
    }
  }

  /**
   * Invalidate all active refresh tokens for a user (password change/reset).
   * @param {string} userId
   */
  async revokeAllUserSessions(userId) {
    await prisma.token.updateMany({
      where: { userId, type: 'REFRESH', revoked: false },
      data: { revoked: true },
    });
  }

  /**
   * Create an email verification token.
   * @param {string} userId
   * @returns {Promise<string>} raw token to include in email URL
   */
  async createEmailVerificationToken(userId) {
    // Revoke previous verification tokens for this user
    await prisma.token.updateMany({
      where: { userId, type: 'EMAIL_VERIFICATION', revoked: false },
      data: { revoked: true },
    });

    const rawToken = generateRandomToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.token.create({
      data: {
        userId,
        tokenHash,
        type: 'EMAIL_VERIFICATION',
        expiresAt,
      },
    });

    return rawToken;
  }

  /**
   * Validate and consume an email verification token.
   * @param {string} rawToken
   * @returns {Promise<string>} userId
   */
  async consumeEmailVerificationToken(rawToken) {
    if (!rawToken) {
      throw ApiError.badRequest('INVALID_TOKEN', 'Verification token is required.');
    }

    const tokenHash = hashToken(rawToken);
    const tokenRecord = await prisma.token.findUnique({
      where: { tokenHash },
    });

    if (
      !tokenRecord ||
      tokenRecord.type !== 'EMAIL_VERIFICATION' ||
      tokenRecord.revoked ||
      tokenRecord.usedAt ||
      new Date() > new Date(tokenRecord.expiresAt)
    ) {
      throw ApiError.badRequest('INVALID_TOKEN', 'Verification token is invalid or has expired.');
    }

    await prisma.token.update({
      where: { id: tokenRecord.id },
      data: { revoked: true, usedAt: new Date() },
    });

    return tokenRecord.userId;
  }

  /**
   * Create a password reset token (1 hour).
   * @param {string} userId
   * @returns {Promise<string>} raw token to include in reset URL
   */
  async createPasswordResetToken(userId) {
    await prisma.token.updateMany({
      where: { userId, type: 'PASSWORD_RESET', revoked: false },
      data: { revoked: true },
    });

    const rawToken = generateRandomToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.token.create({
      data: {
        userId,
        tokenHash,
        type: 'PASSWORD_RESET',
        expiresAt,
      },
    });

    return rawToken;
  }

  /**
   * Validate and consume a password reset token.
   * @param {string} rawToken
   * @returns {Promise<string>} userId
   */
  async consumePasswordResetToken(rawToken) {
    if (!rawToken) {
      throw ApiError.badRequest('INVALID_TOKEN', 'Reset token is required.');
    }

    const tokenHash = hashToken(rawToken);
    const tokenRecord = await prisma.token.findUnique({
      where: { tokenHash },
    });

    if (
      !tokenRecord ||
      tokenRecord.type !== 'PASSWORD_RESET' ||
      tokenRecord.revoked ||
      tokenRecord.usedAt ||
      new Date() > new Date(tokenRecord.expiresAt)
    ) {
      throw ApiError.badRequest('INVALID_TOKEN', 'Reset token is invalid or has expired.');
    }

    await prisma.token.update({
      where: { id: tokenRecord.id },
      data: { revoked: true, usedAt: new Date() },
    });

    return tokenRecord.userId;
  }
}

module.exports = new TokenService();

