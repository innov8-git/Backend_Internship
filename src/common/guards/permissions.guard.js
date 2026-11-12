'use strict';

const { ApiError } = require('../../utils');

/**
 * Permission Guard Factory
 * Enforces that the authenticated user possesses all specified permission codes.
 * Admins automatically bypass permission checks.
 *
 * @param  {...string} requiredPermissions
 */
function requirePermissions(...requiredPermissions) {
  const permissions = requiredPermissions.flat();

  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('UNAUTHENTICATED', 'Authentication required.'));
    }

    // Admin bypass: full access
    if (Array.isArray(req.user.roles) && req.user.roles.includes('ADMIN')) {
      return next();
    }

    const userPermissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];

    for (const perm of permissions) {
      if (!userPermissions.includes(perm)) {
        return next(
          ApiError.forbidden(
            'FORBIDDEN',
            `You lack the required permission: ${perm}`,
          ),
        );
      }
    }

    next();
  };
}

/**
 * Convenience single-permission guard
 * @param {string} permission
 */
function requirePermission(permission) {
  return requirePermissions(permission);
}

module.exports = {
  requirePermission,
  requirePermissions,
};
