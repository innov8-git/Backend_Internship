'use strict';

const { authenticate, optionalAuth, invalidateAuthUserCache } = require('./auth.guard');
const { requireRole, authorize } = require('./roles.guard');
const { requirePermission, requirePermissions } = require('./permissions.guard');

module.exports = {
  authenticate,
  optionalAuth,
  invalidateAuthUserCache,
  requireRole,
  authorize,
  requirePermission,
  requirePermissions,
};
