'use strict';

const crypto = require('crypto');
const { prisma } = require('../../../database');
const { ApiError, hashToken } = require('../../../utils');
const { sendOtpEmail } = require('../../../libs/email');
const tokenService = require('./token.service');
const logger = require('../../../libs/logger');

const VALID_PURPOSES = ['REGISTRATION_VERIFY', 'LOGIN', 'PASSWORD_RESET'];
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_MS = 60 * 1000; // 60 seconds

/**
 * OTP Authentication & Verification Service
 */
class OtpService {
  /**
   * Generate and send a 6-digit numeric OTP to the specified email.
   *
   * @param {object} params
   * @param {string} params.email - Recipient email
   * @param {'REGISTRATION_VERIFY'|'LOGIN'|'PASSWORD_RESET'} params.purpose - Purpose of the OTP
   * @param {string} [params.ipAddress] - Client IP
   * @param {string} [params.userAgent] - Client User Agent
   * @returns {Promise<{ success: boolean, message: string, expiresIn: number }>}
   */
  async generateAndSendOtp({ email, purpose, ipAddress, userAgent }) {
    if (!email) {
      throw ApiError.badRequest('EMAIL_REQUIRED', 'Email address is required.');
    }
    const normalizedEmail = email.toLowerCase().trim();

    if (!VALID_PURPOSES.includes(purpose)) {
      throw ApiError.badRequest('INVALID_PURPOSE', `Purpose must be one of: ${VALID_PURPOSES.join(', ')}.`);
    }

    // Check user existence for LOGIN and PASSWORD_RESET
    let user = null;
    if (purpose === 'LOGIN' || purpose === 'PASSWORD_RESET') {
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (!user) {
        throw ApiError.notFound('User with this email');
      }
      if (purpose === 'LOGIN' && user.status === 'SUSPENDED') {
        throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact support.');
      }
    } else {
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
    }

    // 1. Enforce 60-second cooldown
    const recentOtp = await prisma.otpToken.findFirst({
      where: {
        email: normalizedEmail,
        purpose,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      const elapsedMs = Date.now() - new Date(recentOtp.createdAt).getTime();
      if (elapsedMs < COOLDOWN_MS) {
        const remainingSec = Math.ceil((COOLDOWN_MS - elapsedMs) / 1000);
        throw ApiError.tooManyRequests(`Please wait ${remainingSec} seconds before requesting a new OTP.`);
      }
    }

    // 2. Invalidate any previous unused OTPs for this email and purpose
    await prisma.otpToken.updateMany({
      where: {
        email: normalizedEmail,
        purpose,
        isUsed: false,
      },
      data: { isUsed: true },
    });

    // 3. Generate cryptographically secure 6-digit numeric OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashToken(rawOtp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    // 4. Persist to database
    await prisma.otpToken.create({
      data: {
        email: normalizedEmail,
        otpHash,
        purpose,
        expiresAt,
        attempts: 0,
        maxAttempts: 3,
        isUsed: false,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    // 5. Send Email
    try {
      await sendOtpEmail({
        to: normalizedEmail,
        otp: rawOtp,
        purpose,
        name: user?.name || 'there',
      });
    } catch (err) {
      logger.error(`Failed to send OTP email to ${normalizedEmail}: ${err.message}`);
      // Do not reveal email sending failure details to client if network glitch, but let them know
      throw ApiError.internal('Failed to deliver OTP email. Please try again.');
    }

    return {
      success: true,
      message: 'A 6-digit OTP has been sent to your email.',
      expiresIn: 300,
    };
  }

  /**
   * Verify an OTP record.
   *
   * @param {object} params
   * @param {string} params.email - Recipient email
   * @param {string} params.otp - 6-digit OTP code entered by user
   * @param {'REGISTRATION_VERIFY'|'LOGIN'|'PASSWORD_RESET'} params.purpose - Purpose of the OTP
   * @returns {Promise<{ success: boolean, verified: boolean }>}
   */
  async verifyOtp({ email, otp, purpose }) {
    if (!email || !otp || !purpose) {
      throw ApiError.badRequest('MISSING_FIELDS', 'Email, OTP, and purpose are required.');
    }
    const normalizedEmail = email.toLowerCase().trim();

    const record = await prisma.otpToken.findFirst({
      where: {
        email: normalizedEmail,
        purpose,
        isUsed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw ApiError.badRequest('INVALID_OTP', 'OTP is invalid or has expired.');
    }

    // Check expiration
    if (new Date() > new Date(record.expiresAt)) {
      await prisma.otpToken.update({
        where: { id: record.id },
        data: { isUsed: true },
      });
      throw ApiError.badRequest('OTP_EXPIRED', 'OTP has expired. Please request a new one.');
    }

    // Check max attempts
    if (record.attempts >= record.maxAttempts) {
      await prisma.otpToken.update({
        where: { id: record.id },
        data: { isUsed: true },
      });
      throw ApiError.badRequest(
        'OTP_MAX_ATTEMPTS',
        'Maximum verification attempts exceeded. This OTP is no longer valid. Please request a new one.',
      );
    }

    // Compare hash
    const incomingHash = hashToken(otp.trim());
    if (incomingHash !== record.otpHash) {
      const newAttempts = record.attempts + 1;
      const remaining = record.maxAttempts - newAttempts;

      if (remaining <= 0) {
        await prisma.otpToken.update({
          where: { id: record.id },
          data: { attempts: newAttempts, isUsed: true },
        });
        throw ApiError.badRequest(
          'OTP_MAX_ATTEMPTS',
          'Maximum verification attempts exceeded. This OTP is no longer valid. Please request a new one.',
        );
      }

      await prisma.otpToken.update({
        where: { id: record.id },
        data: { attempts: newAttempts },
      });

      throw ApiError.badRequest('INVALID_OTP', `Incorrect OTP. ${remaining} attempt(s) remaining.`);
    }

    // Mark as used immediately
    await prisma.otpToken.update({
      where: { id: record.id },
      data: { isUsed: true },
    });

    return { success: true, verified: true };
  }

  /**
   * Verify registration OTP and activate user account.
   */
  async verifyRegistration({ email, otp, ipAddress, userAgent }) {
    await this.verifyOtp({ email, otp, purpose: 'REGISTRATION_VERIFY' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw ApiError.notFound('User');
    }

    // Update user to ACTIVE and emailVerified = true
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        emailVerified: true,
      },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    // Extract roles and permissions
    const roles = [];
    const permissionSet = new Set();
    for (const ur of updatedUser.userRoles || []) {
      if (ur.role) {
        roles.push(ur.role.name);
        for (const rp of ur.role.rolePermissions || []) {
          if (rp.permission?.code) permissionSet.add(rp.permission.code);
        }
      }
    }

    // Create session tokens
    const { accessToken, rawRefreshToken } = await tokenService.createSession(
      { id: updatedUser.id, email: updatedUser.email, roles },
      { ipAddress, userAgent },
    );

    return {
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        status: updatedUser.status,
        emailVerified: updatedUser.emailVerified,
        roles,
        permissions: Array.from(permissionSet),
      },
      accessToken,
      rawRefreshToken,
    };
  }

  /**
   * Passwordless login via OTP.
   */
  async loginWithOtp({ email, otp, ipAddress, userAgent }) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw ApiError.notFound('User with this email');
    }

    if (user.status === 'SUSPENDED') {
      throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact support.');
    }

    // Verify the OTP
    await this.verifyOtp({ email: normalizedEmail, otp, purpose: 'LOGIN' });

    // If user was PENDING_VERIFICATION, activate on successful login
    if (!user.emailVerified || user.status === 'PENDING_VERIFICATION') {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', emailVerified: true },
      });
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

    // Create session tokens
    const { accessToken, rawRefreshToken } = await tokenService.createSession(
      { id: user.id, email: user.email, roles },
      { ipAddress, userAgent },
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: 'ACTIVE',
        emailVerified: true,
        roles,
        permissions: Array.from(permissionSet),
      },
      accessToken,
      rawRefreshToken,
    };
  }

  /**
   * Verify password reset OTP and return a reset token.
   */
  async verifyResetOtp({ email, otp }) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw ApiError.notFound('User with this email');
    }

    await this.verifyOtp({ email: normalizedEmail, otp, purpose: 'PASSWORD_RESET' });

    // Generate reset token consumable by reset-password endpoint
    const resetToken = await tokenService.createPasswordResetToken(user.id);

    return {
      resetToken,
      message: 'OTP verified successfully. You may now reset your password.',
    };
  }
}

module.exports = new OtpService();
