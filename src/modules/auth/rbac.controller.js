'use strict';

const rbacService = require('./services/rbac.service');
const { asyncHandler, ok, ApiError } = require('../../utils');

/**
 * RBAC Controller — Role and Permission Management
 */

/**
 * GET /api/v1/rbac/roles
 */
const getRoles = asyncHandler(async (_req, res) => {
  const roles = await rbacService.getAllRolesWithPermissions();
  return ok(res, roles);
});

/**
 * GET /api/v1/rbac/permissions
 */
const getPermissions = asyncHandler(async (_req, res) => {
  const permissions = await rbacService.getAllPermissions();
  return ok(res, permissions);
});

/**
 * POST /api/v1/rbac/assign-role
 */
const assignRole = asyncHandler(async (req, res) => {
  const { userId, roleName } = req.body;
  if (!userId || !roleName) {
    throw ApiError.badRequest('MISSING_FIELDS', 'userId and roleName are required.');
  }

  const result = await rbacService.assignRoleToUser(userId, roleName);
  return ok(res, result, `Role "${roleName}" successfully assigned.`);
});

/**
 * POST /api/v1/rbac/remove-role
 */
const removeRole = asyncHandler(async (req, res) => {
  const { userId, roleName } = req.body;
  if (!userId || !roleName) {
    throw ApiError.badRequest('MISSING_FIELDS', 'userId and roleName are required.');
  }

  await rbacService.removeRoleFromUser(userId, roleName);
  return ok(res, null, `Role "${roleName}" successfully removed.`);
});

module.exports = {
  getRoles,
  getPermissions,
  assignRole,
  removeRole,
};

