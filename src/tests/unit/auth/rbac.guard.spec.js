'use strict';

const { requirePermission, requireRole } = require('../../../common/guards');

describe('Unit: RBAC Guards (src/common/guards)', () => {
  describe('requireRole', () => {
    it('should allow user possessing the required role', () => {
      const middleware = requireRole('TRAINER');
      const req = { user: { roles: ['TRAINER'] } };
      let called = false;

      middleware(req, {}, (err) => {
        expect(err).toBeUndefined();
        called = true;
      });

      expect(called).toBe(true);
    });

    it('should allow ADMIN user regardless of requested role', () => {
      const middleware = requireRole('TRAINER');
      const req = { user: { roles: ['ADMIN'] } };
      let called = false;

      middleware(req, {}, (err) => {
        expect(err).toBeUndefined();
        called = true;
      });

      expect(called).toBe(true);
    });

    it('should block user lacking the required role with 403', () => {
      const middleware = requireRole('ADMIN');
      const req = { user: { roles: ['STUDENT'] } };
      let errorReceived;

      middleware(req, {}, (err) => {
        errorReceived = err;
      });

      expect(errorReceived).toBeDefined();
      expect(errorReceived.statusCode).toBe(403);
    });
  });

  describe('requirePermission', () => {
    it('should allow user possessing the required permission', () => {
      const middleware = requirePermission('task:read');
      const req = { user: { roles: ['STUDENT'], permissions: ['task:read', 'task:submit'] } };
      let called = false;

      middleware(req, {}, (err) => {
        expect(err).toBeUndefined();
        called = true;
      });

      expect(called).toBe(true);
    });

    it('should block user lacking the required permission with 403', () => {
      const middleware = requirePermission('task:evaluate');
      const req = { user: { roles: ['STUDENT'], permissions: ['task:read', 'task:submit'] } };
      let errorReceived;

      middleware(req, {}, (err) => {
        errorReceived = err;
      });

      expect(errorReceived).toBeDefined();
      expect(errorReceived.statusCode).toBe(403);
    });

    it('should allow ADMIN to bypass any permission check', () => {
      const middleware = requirePermission('task:evaluate');
      const req = { user: { roles: ['ADMIN'], permissions: [] } };
      let called = false;

      middleware(req, {}, (err) => {
        expect(err).toBeUndefined();
        called = true;
      });

      expect(called).toBe(true);
    });
  });
});

