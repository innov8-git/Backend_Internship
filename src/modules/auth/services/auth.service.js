'use strict';

const crypto = require('crypto');
const { prisma } = require('../../../database');
const { ApiError, hashPassword, comparePassword } = require('../../../utils');
const tokenService = require('./token.service');
const logger = require('../../../libs/logger');
const otpService = require('./otp.service');
const googleAuthService = require('./google-auth.service');
const { invalidateAuthUserCache } = require('../../../common/guards');
const { normalizeReferralCode } = require('../../admin/services/tpo-code.util');

/**
 * Authentication Service
 * Implements business logic for registration, authentication, password recovery, and email verification.
 */
class AuthService {
  /**
   * Resolves an optional TPO referral code.
   * Returns null when no code is supplied; throws 422 when invalid or inactive.
   */
  async resolveActiveTpoByReferralCode(rawCode) {
    const normalized = normalizeReferralCode(rawCode);
    if (!normalized) return null;

    const tpo = await prisma.tpo.findUnique({
      where: { referralCode: normalized },
      select: {
        id: true,
        name: true,
        college: true,
        referralCode: true,
        isActive: true,
      },
    });

    if (!tpo || !tpo.isActive) {
      throw ApiError.validationError([
        {
          field: 'referralCode',
          message: 'Invalid or inactive TPO reference code. Please double-check with your TPO.',
        },
      ]);
    }

    return tpo;
  }

  /**
   * Public validation helper for live registration feedback.
   */
  async validateReferralCode(rawCode) {
    const normalized = normalizeReferralCode(rawCode);
    if (!normalized) {
      throw ApiError.notFound('Reference code not found.');
    }

    const tpo = await prisma.tpo.findUnique({
      where: { referralCode: normalized },
      select: {
        id: true,
        name: true,
        college: true,
        referralCode: true,
        isActive: true,
      },
    });

    if (!tpo || !tpo.isActive) {
      throw ApiError.notFound('Invalid or inactive TPO reference code.');
    }

    return {
      valid: true,
      referralCode: tpo.referralCode,
      tpoName: tpo.name,
      college: tpo.college,
    };
  }

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

    const referredTpo = await this.resolveActiveTpoByReferralCode(dto.referralCode);

    const passwordHash = await hashPassword(dto.password);
    const roleName = 'STUDENT';

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
          referredByTpoId: referredTpo?.id || null,
          referralCodeUsed: referredTpo?.referralCode || null,
        },
      });

      // Link User to Role
      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: roleRecord.id,
        },
      });

      return user;
    });

    // Generate OTP for email verification (fire-and-forget — never blocks the response)
    otpService.generateAndSendOtp({
      email: result.email,
      purpose: 'REGISTRATION_VERIFY',
    }).catch((err) => {
      logger.warn('Failed to dispatch registration OTP:', err.message);
    });

    // Generate email verification token (fire-and-forget)
    tokenService.createEmailVerificationToken(result.id)
      .then((rawVerifyToken) => {
        logger.info(`[Auth] Verification token created for ${result.email}: ${rawVerifyToken}`);
      })
      .catch((err) => {
        logger.warn(`Failed to dispatch verification email for ${result.email}:`, err.message);
      });

    return {
      id: result.id,
      name: result.name,
      email: result.email,
      roles: [roleName],
      status: result.status,
      emailVerified: result.emailVerified,
      referralCodeUsed: result.referralCodeUsed || null,
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
        _id: user.id,
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        emailVerified: user.emailVerified,
        roles,
        permissions: Array.from(permissionSet),
        ...pickProfile(user),
        authProvider: user.authProvider,
        trainerProfile: user.trainerProfile || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
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
      _id: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
      roles,
      permissions: Array.from(permissionSet),
      ...pickProfile(user),
      authProvider: user.authProvider,
      trainerProfile: user.trainerProfile || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Self-service profile update (PATCH /auth/me).
   * @param {string} userId
   * @param {object} dto - validated by updateMeSchema (no email/roles/status/password)
   */
  async updateMe(userId, dto) {
    const { trainerProfile, ...fields } = dto;

    const data = {};
    for (const key of PROFILE_FIELDS) {
      if (fields[key] === undefined) continue;
      const value = fields[key];
      data[key] = value === '' || value === null ? null : String(value);
    }
    if (fields.name !== undefined) data.name = fields.name;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } }, trainerProfile: true },
    });
    if (!user) throw ApiError.unauthorized('UNAUTHENTICATED', 'User not found.');

    const isTrainer = user.userRoles.some((ur) => ur.role?.name === 'TRAINER');

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: userId }, data });
      }

      if (trainerProfile && isTrainer) {
        const tp = {};
        for (const key of TRAINER_PROFILE_FIELDS) {
          if (trainerProfile[key] === undefined) continue;
          const v = trainerProfile[key];
          if (key === 'resumeSize') tp[key] = v === null ? null : Number(v);
          else tp[key] = v === '' || v === null ? null : String(v);
        }
        if (trainerProfile.resumeName === '' || trainerProfile.resumeName === null) {
          tp.resumeUrl = null;
          tp.resumeKey = null;
          tp.resumeMimeType = null;
        }
        if (Object.keys(tp).length > 0) {
          await tx.trainerProfile.upsert({
            where: { userId },
            update: tp,
            create: {
              userId,
              domain: tp.domain || '',
              experience: tp.experience || '',
              ...tp,
            },
          });
        }
      }
    });

    invalidateAuthUserCache(userId);
    logger.info(`[Auth] Profile updated for user ${userId}`);
    return this.getMe(userId);
  }

  /**
   * Persist an uploaded avatar URL for the current user (POST /auth/me/avatar).
   */
  async setAvatarUrl(userId, avatarUrl) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw ApiError.unauthorized('UNAUTHENTICATED', 'User not found.');

    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: avatarUrl || null },
    });

    invalidateAuthUserCache(userId);
    logger.info(`[Auth] Avatar uploaded for user ${userId}`);
    return this.getMe(userId);
  }

  /**
   * Persist an uploaded resume on the trainer's profile (POST /auth/me/resume).
   */
  async setTrainerResume(userId, { resumeUrl, resumeKey, resumeName, resumeMimeType, resumeSize }) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } }, trainerProfile: true },
    });
    if (!existing) throw ApiError.unauthorized('UNAUTHENTICATED', 'User not found.');

    const isTrainer = existing.userRoles.some((ur) => ur.role?.name === 'TRAINER');
    if (!isTrainer) {
      throw ApiError.forbidden('FORBIDDEN', 'Only trainer accounts can upload a trainer resume.');
    }

    const previousResumeKey = existing.trainerProfile?.resumeKey || null;

    await prisma.trainerProfile.upsert({
      where: { userId },
      update: { resumeUrl, resumeKey, resumeName, resumeMimeType, resumeSize },
      create: {
        userId,
        domain: '',
        experience: '',
        resumeUrl,
        resumeKey,
        resumeName,
        resumeMimeType,
        resumeSize,
      },
    });

    invalidateAuthUserCache(userId);
    logger.info(`[Auth] Trainer resume uploaded for user ${userId}`);
    return {
      user: await this.getMe(userId),
      previousResumeKey,
    };
  }

  /**
   * Sign in (or sign up) with Google (POST /auth/google).
   * New users become ACTIVE, email-verified STUDENTs with an unusable password.
   * @param {{ credential?: string, code?: string }} payload
   * @param {{ ipAddress?: string, userAgent?: string }} metadata
   */
  async loginWithGoogle(payload, metadata = {}) {
    const profile = await googleAuthService.verify(payload);
    const email = profile.email.toLowerCase();

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      if (user.status === 'SUSPENDED') {
        throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact support.');
      }
      const updates = {};
      if (!user.googleId) updates.googleId = profile.sub;
      if (!user.emailVerified) updates.emailVerified = true;
      if (user.status === 'PENDING_VERIFICATION') updates.status = 'ACTIVE';
      if (!user.avatarUrl && profile.picture) updates.avatarUrl = profile.picture;
      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({ where: { id: user.id }, data: updates });
      }
    } else {
      const referredTpo = await this.resolveActiveTpoByReferralCode(payload.referralCode);
      const roleRecord = await prisma.roleModel.findUnique({ where: { name: 'STUDENT' } });
      if (!roleRecord) {
        throw ApiError.internal('System role "STUDENT" is not configured. Please run seed script.');
      }
      // Random, never-disclosed password: the account can still set one via "forgot password".
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
      user = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            name: profile.name || email.split('@')[0],
            email,
            passwordHash,
            status: 'ACTIVE',
            emailVerified: true,
            googleId: profile.sub,
            authProvider: 'GOOGLE',
            avatarUrl: profile.picture || null,
            referredByTpoId: referredTpo?.id || null,
            referralCodeUsed: referredTpo?.referralCode || null,
          },
        });
        await tx.userRole.create({ data: { userId: createdUser.id, roleId: roleRecord.id } });
        return createdUser;
      });
      logger.info(`[Auth] New Google account created for ${email}`);
    }

    const me = await this.getMe(user.id);
    const { accessToken, rawRefreshToken } = await tokenService.createSession(
      { id: me.id, email: me.email, roles: me.roles },
      metadata,
    );

    return { user: me, accessToken, rawRefreshToken };
  }
}

const PROFILE_FIELDS = [
  'avatarUrl',
  'phone',
  'headline',
  'bio',
  'location',
  'college',
  'degree',
  'graduationYear',
  'department',
  'organization',
  'linkedinUrl',
  'portfolioUrl',
];

const TRAINER_PROFILE_FIELDS = [
  'domain',
  'experience',
  'organization',
  'linkedinUrl',
  'resumeName',
  'resumeSize',
  'resumeUrl',
  'bio',
];

function pickProfile(user) {
  const out = {};
  for (const key of PROFILE_FIELDS) out[key] = user[key] ?? null;
  return out;
}

module.exports = new AuthService();

