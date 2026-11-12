'use strict';

const { prisma } = require('../../database');
const { ApiError, verifyAccessToken } = require('../../utils');
const { USER_STATUS } = require('../constants');

/**
 * Authentication Middleware
 * Validates Bearer access token, retrieves user, status, roles and granular permissions.
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

    const userId = payload.sub || payload.userId;
    if (!userId) {
      throw ApiError.unauthorized('UNAUTHENTICATED', 'Malformed authentication token.');
    }

    // Load user and related roles + permissions
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw ApiError.unauthorized('UNAUTHENTICATED', 'User no longer exists.');
    }

    if (user.status === USER_STATUS.SUSPENDED) {
      throw ApiError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been suspended. Contact support.');
    }

    // Extract roles and permissions into flat arrays
    const roles = [];
    const permissionSet = new Set();

    if (Array.isArray(user.userRoles)) {
      for (const ur of user.userRoles) {
        if (ur.role) {
          roles.push(ur.role.name);
          if (Array.isArray(ur.role.rolePermissions)) {
            for (const rp of ur.role.rolePermissions) {
              if (rp.permission?.code) {
                permissionSet.add(rp.permission.code);
              }
            }
          }
        }
      }
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
      roles,
      permissions: Array.from(permissionSet),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    next();
  })().catch(next);
}

/**
 * Optional authentication — attaches req.user if valid token exists, proceeds regardless.
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
      const userId = payload.sub || payload.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          emailVerified: true,
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (user && user.status !== USER_STATUS.SUSPENDED) {
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
        req.user = {
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
          emailVerified: user.emailVerified,
          roles,
          permissions: Array.from(permissionSet),
        };
      }
    } catch {
      // Ignore token verification errors for optional auth
    }
    next();
  })().catch(next);
}

module.exports = {
  authenticate,
  optionalAuth,
};
