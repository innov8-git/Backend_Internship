'use strict';

const { prisma } = require('../../../database');
const { ApiError } = require('../../../utils');

/**
 * RBAC Service — Dynamic Role and Permission Resolution
 * Follows SOLID & DRY principles.
 */
class RbacService {
  /**
   * Fetch all roles and deduplicated permissions for a specific user.
   * @param {string} userId
   * @returns {Promise<{ roles: string[], permissions: string[] }>}
   */
  async getUserRolesAndPermissions(userId) {
    const userRoles = await prisma.userRole.findMany({
      where: { userId },
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
    });

    const roles = [];
    const permissionSet = new Set();

    for (const ur of userRoles) {
      if (ur.role) {
        roles.push(ur.role.name);
        for (const rp of ur.role.rolePermissions) {
          if (rp.permission && rp.permission.code) {
            permissionSet.add(rp.permission.code);
          }
        }
      }
    }

    return {
      roles,
      permissions: Array.from(permissionSet),
    };
  }

  /**
   * Fetch only permissions list for a user.
   * @param {string} userId
   * @returns {Promise<string[]>}
   */
  async getUserPermissions(userId) {
    const { permissions } = await this.getUserRolesAndPermissions(userId);
    return permissions;
  }

  /**
   * Fetch only role names for a user.
   * @param {string} userId
   * @returns {Promise<string[]>}
   */
  async getUserRoles(userId) {
    const { roles } = await this.getUserRolesAndPermissions(userId);
    return roles;
  }

  /**
   * Check if user has a specific permission. Admins automatically have all permissions.
   * @param {{ roles?: string[], permissions?: string[] }} user
   * @param {string} permissionCode
   * @returns {boolean}
   */
  hasPermission(user, permissionCode) {
    if (!user) return false;
    if (Array.isArray(user.roles) && user.roles.includes('ADMIN')) return true;
    if (!Array.isArray(user.permissions)) return false;
    return user.permissions.includes(permissionCode);
  }

  /**
   * Check if user has all specified permissions.
   * @param {{ roles?: string[], permissions?: string[] }} user
   * @param {string[]} requiredPermissions
   * @returns {boolean}
   */
  hasAllPermissions(user, requiredPermissions = []) {
    if (!user) return false;
    if (Array.isArray(user.roles) && user.roles.includes('ADMIN')) return true;
    return requiredPermissions.every((perm) => this.hasPermission(user, perm));
  }

  /**
   * Assign a role to a user by role name.
   * @param {string} userId
   * @param {string} roleName - 'STUDENT' | 'TRAINER' | 'ADMIN'
   */
  async assignRoleToUser(userId, roleName) {
    const role = await prisma.roleModel.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      throw ApiError.notFound(`Role "${roleName}" not found.`);
    }

    return prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId,
          roleId: role.id,
        },
      },
      update: {},
      create: {
        userId,
        roleId: role.id,
      },
    });
  }

  /**
   * Remove a role from a user.
   * @param {string} userId
   * @param {string} roleName
   */
  async removeRoleFromUser(userId, roleName) {
    const role = await prisma.roleModel.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      throw ApiError.notFound(`Role "${roleName}" not found.`);
    }

    return prisma.userRole.deleteMany({
      where: {
        userId,
        roleId: role.id,
      },
    });
  }

  /**
   * Get all system roles with mapped permissions.
   */
  async getAllRolesWithPermissions() {
    return prisma.roleModel.findMany({
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get full permission catalog.
   */
  async getAllPermissions() {
    return prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
  }
}

module.exports = new RbacService();

