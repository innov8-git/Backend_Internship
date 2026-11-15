'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seedEnrollments() {
  console.log('🚀 Seeding Student Accounts and Enrollments for Live Backend...');

  const passwordHash = await bcrypt.hash('Password@123', 10);

  // 1. Get or create student role
  const studentRole = await prisma.roleModel.findFirst({
    where: { name: 'STUDENT' },
  });

  if (!studentRole) {
    throw new Error('STUDENT role not found in database. Run seed-rbac.js first.');
  }

  // 2. Demo student definitions
  const demoStudents = [
    {
      name: 'Sanika Waske',
      email: 'sanika6066@gmail.com',
      domainSlug: 'banking',
      durationMonths: 2,
      track: 'web',
      assigned: false,
    },
    {
      name: 'Kedar Deshmukh',
      email: 'deshmukhkedar1234@gmail.com',
      domainSlug: 'healthcare',
      durationMonths: 3,
      track: 'app',
      assigned: false,
    },
    {
      name: 'Alex Mugera',
      email: 'mugera1540@gmail.com',
      domainSlug: 'telecom',
      durationMonths: 1,
      track: 'web',
      assigned: false,
    },
    {
      name: 'Rohan Sharma',
      email: 'rohan.sharma@example.com',
      domainSlug: 'banking',
      durationMonths: 2,
      track: 'web',
      assigned: true,
      projectSlug: 'ledgercore-banking',
    },
    {
      name: 'Aarav Patel',
      email: 'aarav.patel@example.com',
      domainSlug: 'e-commerce',
      durationMonths: 2,
      track: 'web',
      assigned: true,
      projectSlug: 'cartpulse-ecommerce',
    },
    {
      name: 'Priya Nair',
      email: 'priya.nair@example.com',
      domainSlug: 'healthcare',
      durationMonths: 2,
      track: 'app',
      assigned: false,
    },
  ];

  for (const item of demoStudents) {
    // 3. Upsert user
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: { name: item.name, status: 'ACTIVE', emailVerified: true },
      create: {
        name: item.name,
        email: item.email,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
      },
    });

    // Ensure user has STUDENT role
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: studentRole.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: studentRole.id,
      },
    });

    // 4. Find matching Domain and Plan
    const domain = await prisma.domain.findFirst({
      where: { slug: item.domainSlug },
    });

    if (!domain) {
      console.warn(`Domain ${item.domainSlug} not found, skipping`);
      continue;
    }

    const plan = await prisma.internshipPlan.findFirst({
      where: {
        domainId: domain.id,
        durationMonths: item.durationMonths,
      },
    });

    if (!plan) {
      console.warn(`Plan for domain ${item.domainSlug} and duration ${item.durationMonths} not found, skipping`);
      continue;
    }

    // 5. Find Project if assigned
    let assignedProject = null;
    if (item.assigned && item.projectSlug) {
      assignedProject = await prisma.project.findFirst({
        where: { slug: item.projectSlug },
      });
    }

    // 6. Check existing active enrollment or create
    const existingEnrollment = await prisma.enrollment.findFirst({
      where: {
        userId: user.id,
        planId: plan.id,
      },
    });

    if (!existingEnrollment) {
      await prisma.enrollment.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: 'ACTIVE',
          track: item.track,
          projectId: assignedProject ? assignedProject.id : null,
          projectAssignedAt: assignedProject ? new Date() : null,
          activatedAt: new Date(),
        },
      });
      console.log(`✅ Created enrollment for ${user.name} (${user.email}) in ${domain.name} [Track: ${item.track}]`);
    } else {
      await prisma.enrollment.update({
        where: { id: existingEnrollment.id },
        data: {
          track: item.track,
          projectId: assignedProject ? assignedProject.id : existingEnrollment.projectId,
          projectAssignedAt: assignedProject ? new Date() : existingEnrollment.projectAssignedAt,
        },
      });
      console.log(`🔄 Updated enrollment for ${user.name} (${user.email})`);
    }
  }

  const count = await prisma.enrollment.count();
  console.log(`\n🎉 Success! Total active enrollments in PostgreSQL: ${count}`);
}

seedEnrollments()
  .catch((err) => {
    console.error('❌ Error seeding enrollments:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
