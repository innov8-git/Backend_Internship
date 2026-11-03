const { prisma } = require('../../database');
const { ApiError, verifyAccessToken } = require('../../utils');
const { USER_STATUS } = require('../constants');

/**
 * Authentication middleware — verifies the Bearer token, loads the user,
 * and attaches `req.user` for downstream handlers.
 */
function authenticate(req, _res, next) {
  return (async () => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('UNAUTHENTICATED', 'Authentication required.');
    }

    const token = authHeader.split(' ')[1];
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('TOKEN_EXPIRED', 'Your session has expired. Please log in again.');
      }
      throw ApiError.unauthorized('UNAUTHENTICATED', 'Invalid authentication token.');
    }

    // Load user from DB to get fresh roles/status
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw ApiError.unauthorized('UNAUTHENTICATED', 'User no longer exists.');
    }

    if (user.status === USER_STATUS.SUSPENDED) {
      throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended. Contact support.');
    }

    req.user = user;
    next();
  })().catch(next);
}

/**
 * Authorization middleware factory — checks that the user has at least one of the required roles.
 * Must be used AFTER `authenticate`.
 * @param {string[]} roles - Array of allowed roles (e.g. ['ADMIN', 'TRAINER'])
 */
function authorize(...roles) {
  const allowedRoles = roles.flat();
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return next(ApiError.forbidden('FORBIDDEN', "You don't have permission to access this resource."));
    }
    next();
  };
}

/**
 * Optional authentication — attaches req.user if a valid token is present,
 * but does NOT reject the request if no token. Useful for public endpoints
 * that behave differently when authenticated.
 */
function optionalAuth(req, _res, next) {
  return (async () => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    try {
      const token = authHeader.split(' ')[1];
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          name: true,
          email: true,
          roles: true,
          status: true,
          emailVerified: true,
        },
      });
      if (user && user.status !== USER_STATUS.SUSPENDED) {
        req.user = user;
      }
    } catch {
      // Invalid token — treat as unauthenticated
    }
    next();
  })().catch(next);
}

module.exports = { authenticate, authorize, optionalAuth };
