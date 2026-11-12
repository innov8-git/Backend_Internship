'use strict';

const { authenticate, optionalAuth } = require('./auth.guard');
const { requireRole, authorize } = require('./roles.guard');
const { requirePermission, requirePermissions } = require('./permissions.guard');

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  authorize,
  requirePermission,
  requirePermissions,
};
