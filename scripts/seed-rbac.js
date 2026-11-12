'use strict';

/**
 * RBAC Seed Script — Ticket 1
 * Seeds: 3 roles (STUDENT, TRAINER, ADMIN), full permission catalog, role-permission assignments,
 * and 1 default Super Admin user.
 *
 * Run: node scripts/seed-rbac.js
 * Requires DATABASE_URL env var pointing to Supabase Postgres.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

// ─── Permission Catalog ──────────────────────────────────────────────────────

const PERMISSIONS = [
  // Auth
  { code: 'auth:profile:read',   name: 'Read Own Profile',       module: 'auth',  description: 'Read own user profile' },
  { code: 'auth:profile:update', name: 'Update Own Profile',     module: 'auth',  description: 'Update own user profile' },
  // Users (admin-level)
  { code: 'user:read:any',       name: 'View Any User',          module: 'users', description: 'List and view any user' },
  { code: 'user:update:any',     name: 'Edit Any User',          module: 'users', description: 'Edit any user record' },
  { code: 'user:delete',         name: 'Suspend/Delete User',    module: 'users', description: 'Soft-delete or suspend users' },
  // Trainer profile
  { code: 'trainer:profile:read',   name: 'View Trainer Profile',  module: 'trainer', description: 'View trainer extended profile' },
  { code: 'trainer:profile:update', name: 'Edit Trainer Profile',  module: 'trainer', description: 'Edit own trainer profile' },
  { code: 'trainer:approve',        name: 'Approve Trainer',       module: 'trainer', description: 'Approve pending trainer accounts' },
  // Tasks
  { code: 'task:read',     name: 'View Tasks',          module: 'tasks', description: 'Read task list' },
  { code: 'task:submit',   name: 'Submit Task',          module: 'tasks', description: 'Submit task solutions (student)' },
  { code: 'task:evaluate', name: 'Evaluate Tasks',       module: 'tasks', description: 'Grade student task submissions' },
  // Assessments
  { code: 'assessment:attempt',  name: 'Attempt Assessment', module: 'assessment', description: 'Take assessments (student)' },
  { code: 'assessment:evaluate', name: 'Review Assessments', module: 'assessment', description: 'Review assessment submissions' },
  // RBAC
  { code: 'rbac:manage', name: 'Manage Roles & Permissions', module: 'rbac', description: 'Assign roles and modify permissions' },
];

// ─── Role → Permission mapping ────────────────────────────────────────────────

const ROLE_PERMISSIONS = {
  STUDENT: [
    'auth:profile:read', 'auth:profile:update',
    'task:read', 'task:submit',
    'assessment:attempt',
    'trainer:profile:read',
  ],
  TRAINER: [
    'auth:profile:read', 'auth:profile:update',
    'task:read', 'task:evaluate',
    'assessment:evaluate',
    'trainer:profile:read', 'trainer:profile:update',
  ],
  ADMIN: PERMISSIONS.map((p) => p.code), // Admin gets everything
};

// ─── Role definitions ─────────────────────────────────────────────────────────

const ROLES = [
  { name: 'STUDENT', displayName: 'Student',  description: 'Intern / learner enrolled in an internship programme' },
  { name: 'TRAINER', displayName: 'Trainer',  description: 'Domain expert who evaluates and mentors students' },
  { name: 'ADMIN',   displayName: 'Admin',    description: 'System administrator with full access' },
];

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding RBAC…');

  // 1. Upsert permissions
  console.log('  → Upserting permissions…');
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where:  { code: perm.code },
      update: { name: perm.name, description: perm.description, module: perm.module },
      create: { ...perm },
    });
  }

  // 2. Upsert roles
  console.log('  → Upserting roles…');
  const roleMap = {}; // name -> RoleModel record
  for (const role of ROLES) {
    const record = await prisma.roleModel.upsert({
      where:  { name: role.name },
      update: { displayName: role.displayName, description: role.description },
      create: { name: role.name, displayName: role.displayName, description: role.description, isSystem: true },
    });
    roleMap[role.name] = record;
  }

  // 3. Assign permissions to roles (idempotent via upsert on composite key)
  console.log('  → Assigning permissions to roles…');
  for (const [roleName, permCodes] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleMap[roleName];
    for (const code of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where:  { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // 4. Create default Super Admin user (idempotent)
  const adminEmail = process.env.ADMIN_SEED_EMAIL || 'admin@alfre.com';
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'Admin@123456';
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

  console.log(`  → Upserting default admin: ${adminEmail}…`);
  const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

  const adminUser = await prisma.user.upsert({
    where:  { email: adminEmail },
    update: {},
    create: {
      name:          'Super Admin',
      email:         adminEmail,
      passwordHash,
      status:        'ACTIVE',
      emailVerified: true,
    },
  });

  // Assign ADMIN role to admin user
  const adminRole = roleMap['ADMIN'];
  await prisma.userRole.upsert({
    where:  { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  console.log('✅  Seed complete.');
  console.log(`    Admin email:    ${adminEmail}`);
  console.log(`    Admin password: ${adminPassword}`);
  console.log('    ⚠️  Change the admin password immediately after first login.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());

