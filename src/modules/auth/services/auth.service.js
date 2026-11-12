'use strict';

const { prisma } = require('../../../database');
const { ApiError, hashPassword, comparePassword } = require('../../../utils');
const tokenService = require('./token.service');
const rbacService = require('./rbac.service');
const logger = require('../../../libs/logger');

/**
 * Authentication Service
 * Implements business logic for registration, authentication, password recovery, and email verification.
 */
class AuthService {
  /**
   * Register a new Student or Trainer.
   * @param {object} dto - Validated registration payload
   * @returns {Promise<object>} Created user summary
   */
  async register(dto) {
    const existing = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw ApiError.conflict(
        'DUPLICATE_EMAIL',
        'An account with this email already exists.',
        [{ field: 'email', message: 'This email is already in use.' }],
      );
    }

    const passwordHash = await hashPassword(dto.password);
    const roleName = dto.role === 'TRAINER' ? 'TRAINER' : 'STUDENT';

    // Verify role exists in database
    const roleRecord = await prisma.roleModel.findUnique({
      where: { name: roleName },
    });

    if (!roleRecord) {
      throw ApiError.internal(`System role "${roleName}" is not configured. Please run seed script.`);
    }

    // Execute atomic user creation
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email.toLowerCase(),
          passwordHash,
          status: 'PENDING_VERIFICATION',
          emailVerified: false,
        },
      });

      // Link User to Role
      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: roleRecord.id,
        },
      });

      // If Trainer, create extended profile
      if (roleName === 'TRAINER') {
        await tx.trainerProfile.create({
          data: {
            userId: user.id,
            domain: dto.domain,
            experience: dto.experience,
            linkedinUrl: dto.linkedinUrl || null,
            organization: dto.organization || null,
            resumeUrl: dto.resumeUrl || null,
            isApproved: false, // Trainer accounts require admin approval
          },
        });
      }

      return user;
    });

    // Generate email verification token (non-blocking email send)
    try {
      const rawVerifyToken = await tokenService.createEmailVerificationToken(result.id);
      logger.info(`[Auth] Verification token created for ${result.email}: ${rawVerifyToken}`);
      // In production with SMTP configured:
      // await sendEmail({ to: result.email, template: 'verify-email', payload: { token: rawVerifyToken } });
    } catch (err) {
      logger.warn(`Failed to dispatch verification email for ${result.email}:`, err.message);
    }

    return {
      id: result.id,
      name: result.name,
      email: result.email,
      roles: [roleName],
      status: result.status,
      emailVerified: result.emailVerified,
    };
  }

  /**
   * Authenticate a user and create session tokens.
   * @param {string} email
   * @param {string} password
   * @param {{ ipAddress?: string, userAgent?: string }} metadata
   * @returns {Promise<{ user: object, accessToken: string, rawRefreshToken: string }>}
   */
  async login(email, password, metadata = {}) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
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
    });

    // Timing attack mitigation: verify hash even if user not found
    if (!user) {
      await comparePassword(password, '$2a$12$e80yE6u9w1rT97d1F6LzK.1gJtY67m6E38a3B5c9D1e2F3g4H5i6J');
      throw ApiError.invalidCredentials();
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      throw ApiError.invalidCredentials();
    }

    if (user.status === 'SUSPENDED') {
      throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact support.');
    }

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

    const { accessToken, rawRefreshToken } = await tokenService.createSession(
      { id: user.id, email: user.email, roles },
      metadata,
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        emailVerified: user.emailVerified,
        roles,
        permissions: Array.from(permissionSet),
      },
      accessToken,
      rawRefreshToken,
    };
  }

  /**
   * Rotate refresh token and issue new session.
   * @param {string} rawRefreshToken
   * @param {{ ipAddress?: string, userAgent?: string }} metadata
   */
  async refreshToken(rawRefreshToken, metadata = {}) {
    return tokenService.rotateRefreshToken(rawRefreshToken, metadata);
  }

  /**
   * Terminate active session.
   * @param {string} rawRefreshToken
   */
  async logout(rawRefreshToken) {
    if (rawRefreshToken) {
      await tokenService.revokeRefreshToken(rawRefreshToken);
    }
  }

  /**
   * Request password reset link.
   * @param {string} email
   */
  async forgotPassword(email) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success message to prevent user enumeration
    if (!user) {
      return { message: 'If this email is registered, a password reset link has been sent.' };
    }

    try {
      const rawResetToken = await tokenService.createPasswordResetToken(user.id);
      logger.info(`[Auth] Password reset token created for ${user.email}: ${rawResetToken}`);
      // In production with SMTP configured:
      // await sendEmail({ to: user.email, template: 'reset-password', payload: { token: rawResetToken } });
    } catch (err) {
      logger.warn(`Failed to dispatch password reset email for ${user.email}:`, err.message);
    }

    return { message: 'If this email is registered, a password reset link has been sent.' };
  }

  /**
   * Reset user password with token and revoke existing sessions.
   * @param {string} token
   * @param {string} newPassword
   */
  async resetPassword(token, newPassword) {
    const userId = await tokenService.consumePasswordResetToken(token);
    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      // Revoke all active refresh tokens (logs out all devices)
      await tx.token.updateMany({
        where: { userId, type: 'REFRESH', revoked: false },
        data: { revoked: true },
      });
    });

    return { message: 'Password has been reset successfully. Please log in with your new password.' };
  }

  /**
   * Verify email address with token.
   * @param {string} token
   */
  async verifyEmail(token) {
    const userId = await tokenService.consumeEmailVerificationToken(token);

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        status: 'ACTIVE',
      },
    });

    return { message: 'Email verified successfully. You can now log in.' };
  }

  /**
   * Resend email verification link.
   * @param {string} email
   */
  async resendVerification(email) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return { message: 'If this email is registered, a new verification link has been sent.' };
    }

    if (user.emailVerified) {
      return { message: 'Email address is already verified.' };
    }

    try {
      const rawVerifyToken = await tokenService.createEmailVerificationToken(user.id);
      logger.info(`[Auth] Verification token resent to ${user.email}: ${rawVerifyToken}`);
    } catch (err) {
      logger.warn(`Failed to resend verification email for ${user.email}:`, err.message);
    }

    return { message: 'If this email is registered, a new verification link has been sent.' };
  }

  /**
   * Get user profile with roles and permissions.
   * @param {string} userId
   */
  async getMe(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        trainerProfile: true,
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
    });

    if (!user) {
      throw ApiError.unauthorized('UNAUTHENTICATED', 'User not found.');
    }

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

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
      roles,
      permissions: Array.from(permissionSet),
      trainerProfile: user.trainerProfile || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

module.exports = new AuthService();

