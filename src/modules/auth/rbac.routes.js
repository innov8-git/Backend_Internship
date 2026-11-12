'use strict';

const { Router } = require('express');
const rbacController = require('./rbac.controller');
const { authenticate, requireRole, requirePermission } = require('../../common/guards');

const router = Router();

// All RBAC management routes require authentication
router.use(authenticate);

// List all roles (requires ADMIN)
router.get('/roles', requireRole('ADMIN'), rbacController.getRoles);

// List all system permissions (requires ADMIN)
router.get('/permissions', requireRole('ADMIN'), rbacController.getPermissions);

// Assign role to user (requires rbac:manage permission)
router.post('/assign-role', requirePermission('rbac:manage'), rbacController.assignRole);

// Remove role from user (requires rbac:manage permission)
router.post('/remove-role', requirePermission('rbac:manage'), rbacController.removeRole);

module.exports = router;

