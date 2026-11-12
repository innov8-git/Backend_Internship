'use strict';

const request = require('supertest');
const app = require('../../../app');

jest.setTimeout(30000);

describe('Integration: Authentication & RBAC API Endpoints', () => {
  let studentAccessToken;
  let adminAccessToken;
  let refreshTokenCookie;

  describe('POST /api/v1/auth/login', () => {
    it('should reject invalid password with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'student1@alfre.com',
          password: 'WrongPassword@999',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should authenticate student and return access token & set refresh cookie', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'student1@alfre.com',
          password: 'Student@123456',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.email).toBe('student1@alfre.com');
      expect(res.body.data.user.roles).toContain('STUDENT');
      expect(Array.isArray(res.body.data.user.permissions)).toBe(true);

      studentAccessToken = res.body.data.accessToken;

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
      refreshTokenCookie = cookies.find((c) => c.startsWith('refreshToken='));
    });

    it('should authenticate admin and return access token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@alfre.com',
          password: 'Admin@123456',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.roles).toContain('ADMIN');
      adminAccessToken = res.body.data.accessToken;
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return current user profile and permissions for valid token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${studentAccessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('student1@alfre.com');
      expect(res.body.data.roles).toContain('STUDENT');
    });
  });

  describe('RBAC Access Control', () => {
    it('should block Student from viewing /api/v1/rbac/roles with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${studentAccessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow Admin to view /api/v1/rbac/roles with 200 OK', async () => {
      const res = await request(app)
        .get('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const roleNames = res.body.data.map((r) => r.name);
      expect(roleNames).toContain('STUDENT');
      expect(roleNames).toContain('TRAINER');
      expect(roleNames).toContain('ADMIN');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should clear refresh token cookie and return 200', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', refreshTokenCookie ? [refreshTokenCookie] : []);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
