require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password@123';

const DESIGNATIONS = [
  {
    name: 'Java Developer',
    slug: 'java-developer',
    description:
      'Build and maintain backend services with Java 17 and Spring Boot the way enterprise teams do. You start by debugging, merging and reviewing code in an existing repository, then design REST APIs, JPA persistence, transactions, logging and automated tests.',
    status: 'PUBLISHED',
  },
  {
    name: 'Full Stack Developer',
    slug: 'full-stack-developer',
    description:
      'Ship complete features across a React front end and a Node.js and Express API backed by MongoDB. You build responsive interfaces, REST endpoints, authentication and checkout flows, and learn to debug across the browser, the network and the server.',
    status: 'PUBLISHED',
  },
  {
    name: '.NET Developer',
    slug: 'dotnet-developer',
    description:
      'Build secure, well-tested web APIs with C#, ASP.NET Core and Entity Framework Core. You work with dependency injection, middleware, LINQ, async code and database migrations, and cover your work with xUnit tests.',
    status: 'PUBLISHED',
  },
  {
    name: 'DevOps Engineer',
    slug: 'devops-engineer',
    description:
      'Automate how software is built, shipped and run in production. You write CI/CD pipelines, package services with Docker, deploy them to Kubernetes, manage infrastructure with Terraform and set up monitoring and alerts.',
    status: 'PUBLISHED',
  },
  {
    name: 'Data Engineer',
    slug: 'data-engineer',
    description:
      'Design pipelines that turn raw data into reliable, query-ready tables. You model warehouses, write SQL and PySpark transformations, orchestrate jobs with Airflow and add data-quality checks.',
    status: 'DRAFT',
  },
];

const DOMAINS = [
  {
    name: 'Banking',
    slug: 'banking',
    description:
      'Accounts, fund transfers, ledgers and statements for a retail bank, where correctness, auditability and safe transaction handling come first.',
    status: 'PUBLISHED',
  },
  {
    name: 'Healthcare',
    slug: 'healthcare',
    description:
      'Appointments, patient records and clinical workflows for a chain of clinics, built with strict privacy rules and role-based access to sensitive data.',
    status: 'PUBLISHED',
  },
  {
    name: 'Telecom',
    slug: 'telecom',
    description:
      'Usage rating, billing and subscriber services for a mobile operator that processes millions of call and data records every day and must stay available around the clock.',
    status: 'PUBLISHED',
  },
  {
    name: 'E-commerce',
    slug: 'e-commerce',
    description:
      'Product catalogues, carts, checkout, payments and order tracking for an online store, where speed and reliability directly affect revenue.',
    status: 'PUBLISHED',
  },
  {
    name: 'Insurance',
    slug: 'insurance',
    description:
      'Policy administration, premium calculation and claims processing for a general insurer, with a clear audit trail for every decision.',
    status: 'DRAFT',
  },
];

const BASE_PRICES = {
  1: 499900,
  2: 899900,
  3: 1299900,
  4: 1599900,
  6: 2199900,
};

const DEFAULT_SLABS = [
  { minScore: 0, maxScore: 5, discountPercent: 0 },
  { minScore: 6, maxScore: 9, discountPercent: 10 },
  { minScore: 10, maxScore: 12, discountPercent: 15 },
  { minScore: 13, maxScore: 15, discountPercent: 25 },
];

async function seed() {
  console.log('🌱 Starting database seed...');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // 1. Users
  console.log('Seeding demo users...');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.dev' },
    update: {},
    create: {
      name: 'Vikram Singh',
      email: 'admin@demo.dev',
      passwordHash,
      roles: ['ADMIN'],
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const trainer = await prisma.user.upsert({
    where: { email: 'trainer@demo.dev' },
    update: {},
    create: {
      name: 'Priya Nair',
      email: 'trainer@demo.dev',
      passwordHash,
      roles: ['TRAINER'],
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const student = await prisma.user.upsert({
    where: { email: 'student@demo.dev' },
    update: {},
    create: {
      name: 'Aarav Sharma',
      email: 'student@demo.dev',
      passwordHash,
      roles: ['STUDENT'],
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const newStudent = await prisma.user.upsert({
    where: { email: 'new.student@demo.dev' },
    update: {},
    create: {
      name: 'Diya Patel',
      email: 'new.student@demo.dev',
      passwordHash,
      roles: ['STUDENT'],
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const pendingStudent = await prisma.user.upsert({
    where: { email: 'pending@demo.dev' },
    update: {},
    create: {
      name: 'Kabir Mehta',
      email: 'pending@demo.dev',
      passwordHash,
      roles: ['STUDENT'],
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const unverifiedStudent = await prisma.user.upsert({
    where: { email: 'unverified@demo.dev' },
    update: {},
    create: {
      name: 'Isha Reddy',
      email: 'unverified@demo.dev',
      passwordHash,
      roles: ['STUDENT'],
      status: 'PENDING_VERIFICATION',
      emailVerified: false,
    },
  });

  const graduateStudent = await prisma.user.upsert({
    where: { email: 'graduate@demo.dev' },
    update: {},
    create: {
      name: 'Meera Iyer',
      email: 'graduate@demo.dev',
      passwordHash,
      roles: ['STUDENT'],
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const leaderStudent = await prisma.user.upsert({
    where: { email: 'leader@demo.dev' },
    update: {},
    create: {
      name: 'Rohan Gupta',
      email: 'leader@demo.dev',
      passwordHash,
      roles: ['STUDENT'],
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const suspendedUser = await prisma.user.upsert({
    where: { email: 'suspended@demo.dev' },
    update: {},
    create: {
      name: 'Nikhil Verma',
      email: 'suspended@demo.dev',
      passwordHash,
      roles: ['STUDENT'],
      status: 'SUSPENDED',
      emailVerified: true,
    },
  });

  // 2. Terms Versions
  console.log('Seeding terms...');
  await prisma.termsVersion.upsert({
    where: { version: 1 },
    update: {},
    create: {
      version: 1,
      content: '# Terms and Conditions (v1)\n\nWelcome to the internship portal. All terms apply.',
      publishedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    },
  });

  const termsV2 = await prisma.termsVersion.upsert({
    where: { version: 2 },
    update: {},
    create: {
      version: 2,
      content: '# Terms and Conditions (v2)\n\nWelcome to the internship portal. Complete your tasks with academic integrity. Certificates issued upon verified completion.',
      publishedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });

  // 3. Designations & Domains
  console.log('Seeding catalog designations & domains...');
  const desigMap = new Map();
  for (const d of DESIGNATIONS) {
    const created = await prisma.designation.upsert({
      where: { slug: d.slug },
      update: {},
      create: {
        name: d.name,
        slug: d.slug,
        description: d.description,
        status: d.status,
        createdBy: admin.id,
      },
    });
    desigMap.set(d.slug, created);
  }

  const domainMap = new Map();
  for (const dom of DOMAINS) {
    const created = await prisma.domain.upsert({
      where: { slug: dom.slug },
      update: {},
      create: {
        name: dom.name,
        slug: dom.slug,
        description: dom.description,
        status: dom.status,
        createdBy: admin.id,
      },
    });
    domainMap.set(dom.slug, created);
  }

  // 4. Internship Plans
  console.log('Seeding internship plans...');
  const javaDesig = desigMap.get('java-developer');
  const bankingDomain = domainMap.get('banking');
  const fullstackDesig = desigMap.get('full-stack-developer');
  const ecommerceDomain = domainMap.get('e-commerce');

  const plansToCreate = [
    { designationId: javaDesig.id, domainId: bankingDomain.id, durationMonths: 1, basePrice: BASE_PRICES[1] },
    { designationId: javaDesig.id, domainId: bankingDomain.id, durationMonths: 3, basePrice: BASE_PRICES[3] },
    { designationId: javaDesig.id, domainId: bankingDomain.id, durationMonths: 6, basePrice: BASE_PRICES[6] },
    { designationId: fullstackDesig.id, domainId: ecommerceDomain.id, durationMonths: 1, basePrice: BASE_PRICES[1] },
    { designationId: fullstackDesig.id, domainId: ecommerceDomain.id, durationMonths: 3, basePrice: BASE_PRICES[3] },
  ];

  let primaryPlan = null;
  for (const p of plansToCreate) {
    const plan = await prisma.internshipPlan.upsert({
      where: {
        designationId_domainId_durationMonths: {
          designationId: p.designationId,
          domainId: p.domainId,
          durationMonths: p.durationMonths,
        },
      },
      update: {},
      create: {
        designationId: p.designationId,
        domainId: p.domainId,
        durationMonths: p.durationMonths,
        basePrice: p.basePrice,
        currency: 'INR',
        status: 'PUBLISHED',
        createdBy: admin.id,
      },
    });
    if (p.designationId === javaDesig.id && p.durationMonths === 3) {
      primaryPlan = plan;
    }
  }

  // 5. Assessment Configs
  console.log('Seeding assessment configs...');
  const questions15 = Array.from({ length: 15 }, (_, i) => ({
    _id: `q_${i + 1}`,
    text: `Core concept question ${i + 1} regarding software engineering fundamentals and best practices?`,
    options: [
      `Alternative implementation A for question ${i + 1}`,
      `Optimized pattern B for question ${i + 1}`,
      `Correct architectural solution C for question ${i + 1}`,
      `Legacy configuration D for question ${i + 1}`,
    ],
    correctIndex: 2,
    marks: 1,
  }));

  for (const [slug, desig] of desigMap.entries()) {
    const existing = await prisma.assessmentConfig.findFirst({
      where: { designationId: desig.id },
    });
    if (!existing) {
      await prisma.assessmentConfig.create({
        data: {
          designationId: desig.id,
          version: 1,
          status: 'PUBLISHED',
          questions: questions15,
          discountSlabs: DEFAULT_SLABS,
          publishedAt: new Date(),
          createdBy: admin.id,
        },
      });
    }
  }

  // 6. Schedule Templates
  console.log('Seeding schedule template and tasks...');
  const days30 = Array.from({ length: 30 }, (_, i) => ({
    dayNumber: i + 1,
    title: `Day ${i + 1}: ${i === 0 ? 'Environment Setup & Git Workflow' : i === 1 ? 'Data Modeling & Schema' : `Core Engineering Module Part ${i + 1}`}`,
    activity: `Hands-on implementation of the components scheduled for day ${i + 1}.`,
    requiredEvidence: `Inspection notes and commit evidence for day ${i + 1}.`,
    sopContent: `## Purpose\n\nGuide for completing Day ${i + 1} engineering tasks.\n\n## Steps\n\n1. Review the technical requirements.\n2. Implement the assigned interfaces and write unit tests.\n3. Validate the build and commit to git.\n\n## Checklist\n\n- All tests pass.\n- Code formatting matches style guidelines.`,
  }));

  let scheduleTemplate = await prisma.scheduleTemplate.findFirst({
    where: {
      designationId: javaDesig.id,
      domainId: bankingDomain.id,
      durationMonths: 3,
    },
  });

  if (!scheduleTemplate) {
    scheduleTemplate = await prisma.scheduleTemplate.create({
      data: {
        designationId: javaDesig.id,
        domainId: bankingDomain.id,
        durationMonths: 3,
        version: 1,
        status: 'PUBLISHED',
        days: days30,
        publishedAt: new Date(),
        createdBy: admin.id,
      },
    });

    // Create 5 progressive tasks
    const tasks = [
      {
        sequence: 1,
        dayNumber: 2,
        title: 'Task 1: Repository inspection and environment verification',
        problemStatement: 'Set up your local JDK 17 environment, clone the repository, and produce a baseline inspection report.',
        expectedOutcome: 'A clean repository clone with verification notes in docs/inspection-notes.md.',
        acceptanceCriteria: ['JDK 17 and build tool verified', 'All unit tests passing locally'],
        starterRepoUrl: 'https://github.com/innov8-git/Backend_Internship',
        estimatedHours: 4,
        requiresTrainerReview: true,
        prerequisiteTaskIds: [],
      },
      {
        sequence: 2,
        dayNumber: 5,
        title: 'Task 2: REST API endpoints and data validation',
        problemStatement: 'Implement REST endpoints with strict request validation using Joi / express-validator.',
        expectedOutcome: 'Endpoints return proper status codes and match the OpenAPI contract.',
        acceptanceCriteria: ['Invalid inputs return 400 with details', 'Happy path returns 200/201'],
        starterRepoUrl: 'https://github.com/innov8-git/Backend_Internship',
        estimatedHours: 8,
        requiresTrainerReview: true,
        prerequisiteTaskIds: [],
      },
      {
        sequence: 3,
        dayNumber: 10,
        title: 'Task 3: Persistence layer and transaction handling',
        problemStatement: 'Implement persistence using Prisma/PostgreSQL with ACID transaction guarantees.',
        expectedOutcome: 'Atomic operations roll back on failures and persist on success.',
        acceptanceCriteria: ['Transactions rollback cleanly', 'Proper isolation level configured'],
        starterRepoUrl: 'https://github.com/innov8-git/Backend_Internship',
        estimatedHours: 12,
        requiresTrainerReview: true,
        prerequisiteTaskIds: [],
      },
      {
        sequence: 4,
        dayNumber: 18,
        title: 'Task 4: Security middleware and rate limiting',
        problemStatement: 'Secure the application with helmet, CORS, JWT authentication, and strict rate limits.',
        expectedOutcome: 'Unauthorized requests receive 401/403, and excess requests receive 429.',
        acceptanceCriteria: ['Tokens expire appropriately', 'Rate limits prevent abuse'],
        starterRepoUrl: 'https://github.com/innov8-git/Backend_Internship',
        estimatedHours: 10,
        requiresTrainerReview: true,
        prerequisiteTaskIds: [],
      },
      {
        sequence: 5,
        dayNumber: 28,
        title: 'Task 5: End-to-end integration and automated test suite',
        problemStatement: 'Write automated integration tests covering the end-to-end user journeys.',
        expectedOutcome: 'Test suite runs in CI and passes with high code coverage.',
        acceptanceCriteria: ['Integration test coverage >= 80%', 'All edge cases covered'],
        starterRepoUrl: 'https://github.com/innov8-git/Backend_Internship',
        estimatedHours: 16,
        requiresTrainerReview: true,
        prerequisiteTaskIds: [],
      },
    ];

    let prevTaskId = null;
    for (const t of tasks) {
      const createdTask = await prisma.taskDefinition.create({
        data: {
          templateId: scheduleTemplate.id,
          templateVersion: 1,
          sequence: t.sequence,
          dayNumber: t.dayNumber,
          title: t.title,
          problemStatement: t.problemStatement,
          expectedOutcome: t.expectedOutcome,
          acceptanceCriteria: t.acceptanceCriteria,
          starterRepoUrl: t.starterRepoUrl,
          estimatedHours: t.estimatedHours,
          requiresTrainerReview: t.requiresTrainerReview,
          prerequisiteTaskIds: prevTaskId ? [prevTaskId] : [],
          createdBy: admin.id,
        },
      });
      prevTaskId = createdTask.id;
    }
  }

  // 7. Student Attempt & Active Enrollment for Aarav Sharma
  console.log('Seeding student journeys...');
  const aaravAttempt = await prisma.assessmentAttempt.upsert({
    where: {
      userId_designationId: {
        userId: student.id,
        designationId: javaDesig.id,
      },
    },
    update: {},
    create: {
      userId: student.id,
      designationId: javaDesig.id,
      configVersion: 1,
      score: 13,
      totalQuestions: 15,
      discountPercent: 25,
    },
  });

  const priceSnapshot = {
    basePrice: primaryPlan.basePrice,
    discountPercent: 25,
    payableAmount: Math.round(primaryPlan.basePrice * 0.75),
    currency: 'INR',
  };

  const aaravQuote = await prisma.quote.create({
    data: {
      userId: student.id,
      planId: primaryPlan.id,
      enrollmentType: 'INDIVIDUAL',
      attemptId: aaravAttempt.id,
      basePrice: primaryPlan.basePrice,
      discountPercent: 25,
      payableAmount: priceSnapshot.payableAmount,
      currency: 'INR',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const aaravEnrollment = await prisma.enrollment.create({
    data: {
      userId: student.id,
      planId: primaryPlan.id,
      quoteId: aaravQuote.id,
      enrollmentType: 'INDIVIDUAL',
      scheduleTemplateId: scheduleTemplate.id,
      scheduleVersion: 1,
      priceSnapshot,
      status: 'ACTIVE',
      paymentStatus: 'SUCCESS',
      termsAcceptedVersion: 2,
      activatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.termsAcceptance.create({
    data: {
      userId: student.id,
      enrollmentId: aaravEnrollment.id,
      termsVersion: 2,
    },
  });

  const aaravPayment = await prisma.payment.create({
    data: {
      enrollmentId: aaravEnrollment.id,
      userId: student.id,
      orderId: `order_aarav_${Date.now()}`,
      provider: 'mock',
      amount: priceSnapshot.payableAmount,
      currency: 'INR',
      status: 'SUCCESS',
      gatewayReference: 'pay_mock_aarav_success',
    },
  });

  // Assign trainer Priya Nair to Aarav's enrollment
  await prisma.trainerAssignment.create({
    data: {
      trainerId: trainer.id,
      enrollmentId: aaravEnrollment.id,
      active: true,
    },
  });

  // Task progress for Aarav
  const allTasks = await prisma.taskDefinition.findMany({
    where: { templateId: scheduleTemplate.id },
    orderBy: { sequence: 'asc' },
  });

  if (allTasks.length >= 2) {
    // Task 1: Approved
    const p1 = await prisma.taskProgress.create({
      data: {
        enrollmentId: aaravEnrollment.id,
        taskId: allTasks[0].id,
        status: 'APPROVED',
        startedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        submittedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        approvedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
        attempts: 1,
        lastReviewStatus: 'APPROVED',
      },
    });

    const sub1 = await prisma.taskSubmission.create({
      data: {
        taskProgressId: p1.id,
        enrollmentId: aaravEnrollment.id,
        attemptNumber: 1,
        description: 'Completed repository setup, verified builds locally, and added documentation in docs/inspection-notes.md.',
        githubUrl: 'https://github.com/innov8-git/Backend_Internship/pull/1',
        screenshots: [{ storageKey: 'demo1.png', name: 'build-success.png', mimeType: 'image/png', sizeBytes: 102400, url: '/uploads/demo1.png' }],
        submittedById: student.id,
        reviewStatus: 'APPROVED',
      },
    });

    await prisma.review.create({
      data: {
        submissionId: sub1.id,
        trainerId: trainer.id,
        decision: 'APPROVED',
        feedback: 'Excellent work on the setup and documentation. Clean Git workflow.',
      },
    });

    // Task 2: In progress / Submitted awaiting review
    const p2 = await prisma.taskProgress.create({
      data: {
        enrollmentId: aaravEnrollment.id,
        taskId: allTasks[1].id,
        status: 'SUBMITTED',
        startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        attempts: 1,
        lastReviewStatus: 'PENDING',
      },
    });

    await prisma.taskSubmission.create({
      data: {
        taskProgressId: p2.id,
        enrollmentId: aaravEnrollment.id,
        attemptNumber: 1,
        description: 'Implemented the REST API endpoints with full input validation and error handling as specified.',
        githubUrl: 'https://github.com/innov8-git/Backend_Internship/pull/2',
        screenshots: [{ storageKey: 'demo2.png', name: 'api-tests.png', mimeType: 'image/png', sizeBytes: 150000, url: '/uploads/demo2.png' }],
        submittedById: student.id,
        reviewStatus: 'PENDING',
      },
    });

    // Task 3: Available (or locked)
    for (let i = 2; i < allTasks.length; i++) {
      await prisma.taskProgress.create({
        data: {
          enrollmentId: aaravEnrollment.id,
          taskId: allTasks[i].id,
          status: 'LOCKED',
        },
      });
    }
  }

  // 8. Graduate Meera Iyer with Certificate IP-2026-000123
  console.log('Seeding graduate certificate...');
  const meeraEnrollment = await prisma.enrollment.create({
    data: {
      userId: graduateStudent.id,
      planId: primaryPlan.id,
      enrollmentType: 'INDIVIDUAL',
      scheduleTemplateId: scheduleTemplate.id,
      scheduleVersion: 1,
      priceSnapshot,
      status: 'COMPLETED',
      paymentStatus: 'SUCCESS',
      termsAcceptedVersion: 2,
      activatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.certificate.create({
    data: {
      certificateNo: 'IP-2026-000123',
      userId: graduateStudent.id,
      enrollmentId: meeraEnrollment.id,
      status: 'ISSUED',
      emailStatus: 'SENT',
      issuedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
  });

  // 9. Team Leader Rohan Gupta
  console.log('Seeding team...');
  const teamRohan = await prisma.team.create({
    data: {
      name: 'Alpha Coders',
      leaderId: leaderStudent.id,
      planId: primaryPlan.id,
      status: 'FORMING',
      repoUrl: 'https://github.com/innov8-git/alpha-coders',
    },
  });

  await prisma.teamMember.create({
    data: {
      teamId: teamRohan.id,
      userId: leaderStudent.id,
      name: leaderStudent.name,
      email: leaderStudent.email,
      status: 'JOINED',
      isLeader: true,
      joinedAt: new Date(),
    },
  });

  await prisma.teamMember.create({
    data: {
      teamId: teamRohan.id,
      email: 'member2@example.com',
      status: 'INVITED',
      isLeader: false,
      inviteToken: 'invite_demo_token_123',
      inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Assign trainer Priya Nair to Rohan's team
  await prisma.trainerAssignment.create({
    data: {
      trainerId: trainer.id,
      teamId: teamRohan.id,
      active: true,
    },
  });

  console.log('✅ Database seed completed successfully!');
}

seed()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
