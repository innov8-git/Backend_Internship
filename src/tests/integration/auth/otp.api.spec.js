'use strict';

const request = require('supertest');
const app = require('../../../app');
const { prisma } = require('../../../database');
const { hashToken } = require('../../../utils');

jest.setTimeout(30000);

describe('Integration: OTP Authentication API Endpoints', () => {
  const testStudentEmail = 'student1@alfre.com';
  const testRawOtp = '839201';

  afterAll(async () => {
    // Clean up test OTP tokens
    await prisma.otpToken.deleteMany({
      where: { email: testStudentEmail },
    });
  });

  describe('Validation Guardrails', () => {
    it('should reject invalid email format with 422', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/send')
        .send({
          email: 'not-an-email',
          purpose: 'LOGIN',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid purpose with 422', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/send')
        .send({
          email: testStudentEmail,
          purpose: 'INVALID_PURPOSE_HERE',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-6-digit OTP with 422', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/login')
        .send({
          email: testStudentEmail,
          otp: '123', // only 3 digits
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/otp/login', () => {
    it('should successfully log in via valid 6-digit OTP and set refresh cookie', async () => {
      // Create valid OTP record in database for test student
      await prisma.otpToken.deleteMany({ where: { email: testStudentEmail } });
      await prisma.otpToken.create({
        data: {
          email: testStudentEmail,
          otpHash: hashToken(testRawOtp),
          purpose: 'LOGIN',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          attempts: 0,
          maxAttempts: 3,
          isUsed: false,
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/otp/login')
        .send({
          email: testStudentEmail,
          otp: testRawOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Login successful.');
      expect(res.body.data.user.email).toBe(testStudentEmail);
      expect(res.body.data.accessToken).toBeDefined();

      // Check HttpOnly refresh cookie is set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const hasRefreshCookie = cookies.some((c) => c.includes('refreshToken='));
      expect(hasRefreshCookie).toBe(true);
    });

    it('should reject invalid OTP with remaining attempts message', async () => {
      // Create valid OTP
      await prisma.otpToken.deleteMany({ where: { email: testStudentEmail } });
      await prisma.otpToken.create({
        data: {
          email: testStudentEmail,
          otpHash: hashToken('111222'),
          purpose: 'LOGIN',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          attempts: 0,
          maxAttempts: 3,
          isUsed: false,
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/otp/login')
        .send({
          email: testStudentEmail,
          otp: '999999', // Incorrect OTP
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Incorrect OTP. 2 attempt\(s\) remaining/);
    });
  });

  describe('POST /api/v1/auth/otp/verify-reset', () => {
    it('should verify reset OTP and return single-use resetToken', async () => {
      const resetOtp = '654321';
      await prisma.otpToken.deleteMany({ where: { email: testStudentEmail } });
      await prisma.otpToken.create({
        data: {
          email: testStudentEmail,
          otpHash: hashToken(resetOtp),
          purpose: 'PASSWORD_RESET',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          attempts: 0,
          maxAttempts: 3,
          isUsed: false,
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/otp/verify-reset')
        .send({
          email: testStudentEmail,
          otp: resetOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resetToken).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/otp/send cooldown', () => {
    it('should return 429 when requesting OTP faster than 60-second cooldown', async () => {
      // Simulate an OTP requested 15 seconds ago
      await prisma.otpToken.deleteMany({ where: { email: testStudentEmail } });
      await prisma.otpToken.create({
        data: {
          email: testStudentEmail,
          otpHash: hashToken('123456'),
          purpose: 'LOGIN',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          createdAt: new Date(Date.now() - 15 * 1000),
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/otp/send')
        .send({
          email: testStudentEmail,
          purpose: 'LOGIN',
        });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Please wait \d+ seconds before requesting a new OTP/);
    });
  });
});
