'use strict';

const { ApiError } = require('../../utils');

/**
 * Roles Guard Factory
 * Enforces that the user has at least one of the specified roles.
 *
 * @param {...string} roles - e.g. 'ADMIN', 'TRAINER', 'STUDENT'
 */
function requireRole(...roles) {
  const allowedRoles = roles.flat();

  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('UNAUTHENTICATED', 'Authentication required.'));
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];

    // ADMIN always has access
    if (userRoles.includes('ADMIN')) {
      return next();
    }

    const hasAllowedRole = userRoles.some((role) => allowedRoles.includes(role));

    if (!hasAllowedRole) {
      return next(
        ApiError.forbidden(
          'FORBIDDEN',
          "You don't have permission to access this resource.",
        ),
      );
    }

    next();
  };
}

module.exports = {
  requireRole,
  authorize: requireRole,
};
