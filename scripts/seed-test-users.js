'use strict';

/**
 * Seed Test Users Script
 * Creates test accounts for all roles with active verified status:
 * - 1 Admin (admin@alfre.com)
 * - 1 Trainer (trainer@alfre.com) with complete TrainerProfile
 * - 2 Students (student1@alfre.com, student2@alfre.com)
 *
 * Usage: node scripts/seed-test-users.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const TEST_USERS = [
  {
    name: 'Super Administrator',
    email: 'admin@alfre.com',
    password: 'Admin@123456',
    role: 'ADMIN',
  },
  {
    name: 'Senior Mentor Sarah',
    email: 'trainer@alfre.com',
    password: 'Trainer@123456',
    role: 'TRAINER',
    trainerProfile: {
      domain: 'Full Stack Web Development',
      experience: '5-8 years',
      linkedinUrl: 'https://linkedin.com/in/mentor-sarah',
      organization: 'Tech Innovations Corp',
      bio: 'Senior Full Stack Lead with 7+ years of experience in React, Node, and cloud systems.',
      isApproved: true,
    },
  },
  {
    name: 'Alex Rivera (Student)',
    email: 'student1@alfre.com',
    password: 'Student@123456',
    role: 'STUDENT',
  },
  {
    name: 'David Chen (Student)',
    email: 'student2@alfre.com',
    password: 'Student@123456',
    role: 'STUDENT',
  },
];

async function main() {
  console.log('🌱  Seeding test users for all roles…');

  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

  // Cache roles
  const roles = await prisma.roleModel.findMany();
  const roleMap = {};
  for (const r of roles) roleMap[r.name] = r.id;

  for (const userDef of TEST_USERS) {
    const roleId = roleMap[userDef.role];
    if (!roleId) {
      console.warn(`⚠️ Role ${userDef.role} not found. Run "node scripts/seed-rbac.js" first.`);
      continue;
    }

    const passwordHash = await bcrypt.hash(userDef.password, saltRounds);

    const user = await prisma.user.upsert({
      where: { email: userDef.email },
      update: {
        name: userDef.name,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
      },
      create: {
        name: userDef.name,
        email: userDef.email,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
      },
    });

    // Assign Role
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });

    // Create Trainer Profile if applicable
    if (userDef.trainerProfile) {
      await prisma.trainerProfile.upsert({
        where: { userId: user.id },
        update: { ...userDef.trainerProfile },
        create: { userId: user.id, ...userDef.trainerProfile },
      });
    }

    console.log(`  ✅  [${userDef.role}] ${userDef.name} (${userDef.email}) -> Password: ${userDef.password}`);
  }

  console.log('\n🎉  All test users seeded successfully!');
}

main()
  .catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
