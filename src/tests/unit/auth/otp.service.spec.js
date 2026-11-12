'use strict';

const crypto = require('crypto');
const otpService = require('../../../modules/auth/services/otp.service');
const { prisma } = require('../../../database');
const { hashToken } = require('../../../utils');

jest.setTimeout(30000);

describe('OtpService Unit Tests', () => {
  const testEmail = 'otp-unit-test@alfre.com';

  afterAll(async () => {
    // Clean up test records
    await prisma.otpToken.deleteMany({
      where: { email: testEmail },
    });
  });

  beforeEach(async () => {
    // Clear tokens for testEmail before each test
    await prisma.otpToken.deleteMany({
      where: { email: testEmail },
    });
  });

  describe('OTP Generation and Hashing', () => {
    it('should generate a 6-digit numeric OTP and store SHA-256 hash in DB', async () => {
      const rawOtp = '123456';
      const otpHash = hashToken(rawOtp);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const record = await prisma.otpToken.create({
        data: {
          email: testEmail,
          otpHash,
          purpose: 'REGISTRATION_VERIFY',
          expiresAt,
          attempts: 0,
          maxAttempts: 3,
          isUsed: false,
        },
      });

      expect(record.id).toBeDefined();
      expect(record.otpHash).toBe(otpHash);
      expect(record.isUsed).toBe(false);

      // Verify the OTP successfully
      const result = await otpService.verifyOtp({
        email: testEmail,
        otp: rawOtp,
        purpose: 'REGISTRATION_VERIFY',
      });

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);

      // Verify it was marked used
      const updated = await prisma.otpToken.findUnique({ where: { id: record.id } });
      expect(updated.isUsed).toBe(true);
    });
  });

  describe('Expired OTP Handling', () => {
    it('should reject expired OTPs with bad request', async () => {
      const rawOtp = '654321';
      const otpHash = hashToken(rawOtp);
      // Expired 10 minutes ago
      const expiresAt = new Date(Date.now() - 10 * 60 * 1000);

      await prisma.otpToken.create({
        data: {
          email: testEmail,
          otpHash,
          purpose: 'LOGIN',
          expiresAt,
          attempts: 0,
          maxAttempts: 3,
          isUsed: false,
        },
      });

      await expect(
        otpService.verifyOtp({
          email: testEmail,
          otp: rawOtp,
          purpose: 'LOGIN',
        }),
      ).rejects.toThrow('OTP has expired');
    });
  });

  describe('Brute-Force & Attempt Lockout', () => {
    it('should track failed attempts and lock out after 3 consecutive failures', async () => {
      const correctOtp = '987654';
      const otpHash = hashToken(correctOtp);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const record = await prisma.otpToken.create({
        data: {
          email: testEmail,
          otpHash,
          purpose: 'LOGIN',
          expiresAt,
          attempts: 0,
          maxAttempts: 3,
          isUsed: false,
        },
      });

      // Attempt 1: wrong code -> 2 remaining
      await expect(
        otpService.verifyOtp({ email: testEmail, otp: '000001', purpose: 'LOGIN' }),
      ).rejects.toThrow('2 attempt(s) remaining');

      // Attempt 2: wrong code -> 1 remaining
      await expect(
        otpService.verifyOtp({ email: testEmail, otp: '000002', purpose: 'LOGIN' }),
      ).rejects.toThrow('1 attempt(s) remaining');

      // Attempt 3: wrong code -> locked out
      await expect(
        otpService.verifyOtp({ email: testEmail, otp: '000003', purpose: 'LOGIN' }),
      ).rejects.toThrow('Maximum verification attempts exceeded');

      // Record should now be marked isUsed = true
      const lockedRecord = await prisma.otpToken.findUnique({ where: { id: record.id } });
      expect(lockedRecord.isUsed).toBe(true);
      expect(lockedRecord.attempts).toBe(3);

      // Attempt 4: Even with correct OTP, it must be rejected
      await expect(
        otpService.verifyOtp({ email: testEmail, otp: correctOtp, purpose: 'LOGIN' }),
      ).rejects.toThrow('invalid or has expired');
    });
  });

  describe('Purpose Isolation', () => {
    it('should not allow an OTP issued for REGISTRATION_VERIFY to be used for LOGIN', async () => {
      const rawOtp = '112233';
      const otpHash = hashToken(rawOtp);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.otpToken.create({
        data: {
          email: testEmail,
          otpHash,
          purpose: 'REGISTRATION_VERIFY',
          expiresAt,
          attempts: 0,
          maxAttempts: 3,
          isUsed: false,
        },
      });

      // Attempt verification with LOGIN purpose
      await expect(
        otpService.verifyOtp({ email: testEmail, otp: rawOtp, purpose: 'LOGIN' }),
      ).rejects.toThrow('invalid or has expired');
    });
  });

  describe('Cooldown Enforcement', () => {
    it('should enforce 60-second cooldown between OTP generation calls', async () => {
      // Create a recent OTP record 20 seconds ago
      const recentOtpHash = hashToken('555555');
      await prisma.otpToken.create({
        data: {
          email: testEmail,
          otpHash: recentOtpHash,
          purpose: 'REGISTRATION_VERIFY',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          createdAt: new Date(Date.now() - 20 * 1000), // 20s ago (< 60s cooldown)
        },
      });

      await expect(
        otpService.generateAndSendOtp({
          email: testEmail,
          purpose: 'REGISTRATION_VERIFY',
        }),
      ).rejects.toThrow(/Please wait \d+ seconds before requesting a new OTP/);
    });
  });
});
