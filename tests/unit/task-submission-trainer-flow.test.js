'use strict';

process.env.NODE_ENV = 'test';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  roleModel: {
    findUnique: jest.fn(),
  },
  trainerProfile: {
    update: jest.fn(),
  },
  userRole: {
    deleteMany: jest.fn(),
    upsert: jest.fn(),
  },
  internshipPlan: {
    findUnique: jest.fn(),
  },
  assessmentAttempt: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  quote: {
    create: jest.fn(),
  },
  project: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  scheduleTemplate: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  taskDefinition: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  taskProgress: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  taskSubmission: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  review: {
    upsert: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  certificate: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  enrollment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  trainerAssignment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  teamMember: {
    findMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
    createMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../../src/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/modules/audit-log/audit-log.service', () => ({
  addAudit: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/libs/storage', () => ({
  getStorage: () => ({
    upload: jest.fn().mockResolvedValue({
      url: '/uploads/mock-screenshot.png',
      key: 'mock-screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 128,
    }),
  }),
}));
jest.mock('../../src/libs/email', () => ({
  sendProjectAssignedEmail: jest.fn().mockResolvedValue({}),
  sendTaskSubmittedEmail: jest.fn().mockResolvedValue({}),
  sendTaskReviewedEmail: jest.fn().mockResolvedValue({}),
  sendPaymentSuccessEmail: jest.fn().mockResolvedValue({}),
  sendCertificateIssuedEmail: jest.fn().mockResolvedValue({}),
  sendTeamInviteEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../src/app');
const { generateAccessToken } = require('../../src/utils');
const { invalidateAuthUserCache } = require('../../src/common/guards');
const {
  extractProjectTasks,
  syncProjectTasksToEnrollment,
} = require('../../src/modules/admin/services/project-task-sync.service');
const { addAudit } = require('../../src/modules/audit-log/audit-log.service');
const emailLib = require('../../src/libs/email');

const ADMIN_ID = 'admin-1';
const TRAINER_ID = 'trainer-1';
const STUDENT_ID = 'student-1';
const FAKE_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function makeAuthUser(id, roleName) {
  return {
    id,
    name: `${roleName} User`,
    email: `${roleName.toLowerCase()}@example.com`,
    status: 'ACTIVE',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    userRoles: [{ role: { name: roleName, rolePermissions: [] } }],
  };
}

function bearerFor(id, roleName) {
  const token = generateAccessToken({
    sub: id,
    email: `${roleName.toLowerCase()}@example.com`,
    roles: [roleName],
  });
  return `Bearer ${token}`;
}

describe('Cross-role Student / Trainer / Admin task & review flows', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    invalidateAuthUserCache();
    addAudit.mockResolvedValue({});
    emailLib.sendProjectAssignedEmail.mockResolvedValue({});
    emailLib.sendTaskSubmittedEmail.mockResolvedValue({});
    emailLib.sendTaskReviewedEmail.mockResolvedValue({});
    emailLib.sendPaymentSuccessEmail.mockResolvedValue({});
    emailLib.sendCertificateIssuedEmail.mockResolvedValue({});
    emailLib.sendTeamInviteEmail.mockResolvedValue({});
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' });
    mockPrisma.notification.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    mockPrisma.$transaction.mockImplementation(async (arg) => {
      if (typeof arg === 'function') return arg(mockPrisma);
      return Promise.all(arg);
    });
  });

  describe('Project task extraction & materialization', () => {
    test('extractProjectTasks filters empty slots and preserves requiresTrainerReview defaults', () => {
      const project = {
        id: 'proj-1',
        title: 'FinTrack Ledger',
        taskTemplates: {
          web: {
            1: [
              { dayNumber: 1, title: '  Init Monorepo  ', problemStatement: 'Set up repo', estimatedHours: 4 },
              { dayNumber: 2, title: '   ', problemStatement: 'Empty slot should be dropped' },
              {
                dayNumber: 3,
                title: 'Self-Check Linter',
                problemStatement: 'Configure ESLint',
                requiresTrainerReview: false,
              },
            ],
          },
        },
      };

      const tasks = extractProjectTasks(project, 1, 'web');
      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toMatchObject({
        dayNumber: 1,
        sequence: 1,
        title: 'Init Monorepo',
        requiresTrainerReview: true,
      });
      expect(tasks[1]).toMatchObject({
        dayNumber: 3,
        sequence: 2,
        title: 'Self-Check Linter',
        requiresTrainerReview: false,
      });
    });

    test('extractProjectTasks generates structured default milestone tasks when project has no taskTemplates', () => {
      const project = {
        id: 'proj-2',
        title: 'MediCare Portal',
        domain: { name: 'Healthcare' },
        webTechStack: ['React', 'Express', 'PostgreSQL'],
      };

      const tasks = extractProjectTasks(project, 2, 'web');
      expect(tasks).toHaveLength(5);
      expect(tasks[0].dayNumber).toBe(1);
      expect(tasks[0].title).toContain('MediCare Portal');
      expect(tasks.every((t) => t.requiresTrainerReview === true)).toBe(true);
    });

    test('syncProjectTasksToEnrollment materializes ScheduleTemplate, TaskDefinitions, and TaskProgress', async () => {
      const enrollment = {
        id: 'enr-1',
        userId: STUDENT_ID,
        teamId: null,
        track: 'web',
        plan: {
          id: 'plan-1',
          designationId: 'des-1',
          domainId: 'dom-1',
          durationMonths: 1,
        },
      };
      const project = {
        id: 'proj-1',
        title: 'FinTrack Ledger',
        domain: { name: 'Fintech' },
        starterRepoUrl: 'https://github.com/org/starter',
        taskTemplates: {
          web: {
            1: [
              { dayNumber: 1, title: 'Day 1 Setup', problemStatement: 'Setup project' },
              { dayNumber: 2, title: 'Day 2 Auth', problemStatement: 'Build auth' },
            ],
          },
        },
      };

      mockPrisma.enrollment.findUnique.mockResolvedValueOnce(enrollment);
      mockPrisma.scheduleTemplate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ version: 2 });
      mockPrisma.scheduleTemplate.create.mockResolvedValueOnce({
        id: 'sched-1',
        version: 3,
        taskDefinitions: [],
      });
      mockPrisma.taskDefinition.create
        .mockResolvedValueOnce({ id: 'td-1', dayNumber: 1, sequence: 1, prerequisiteTaskIds: [] })
        .mockResolvedValueOnce({ id: 'td-2', dayNumber: 2, sequence: 2, prerequisiteTaskIds: ['td-1'] });
      mockPrisma.enrollment.update.mockResolvedValueOnce({ id: 'enr-1', scheduleTemplateId: 'sched-1' });
      mockPrisma.taskProgress.findMany.mockResolvedValueOnce([]);
      mockPrisma.taskProgress.create
        .mockResolvedValueOnce({ id: 'tp-1', taskId: 'td-1', status: 'AVAILABLE' })
        .mockResolvedValueOnce({ id: 'tp-2', taskId: 'td-2', status: 'LOCKED' });

      const result = await syncProjectTasksToEnrollment('enr-1', project, { actorId: ADMIN_ID });

      expect(result.template.id).toBe('sched-1');
      expect(result.taskCount).toBe(2);
      expect(mockPrisma.taskProgress.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            enrollmentId: 'enr-1',
            taskId: 'td-1',
            status: 'AVAILABLE',
          }),
        }),
      );
      expect(mockPrisma.taskProgress.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            enrollmentId: 'enr-1',
            taskId: 'td-2',
            status: 'LOCKED',
          }),
        }),
      );
    });
  });

  describe('POST /api/v1/enrollments/quote without assessment gate', () => {
    test('computes fee quote using plan discountPercent and returns quoteId', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(STUDENT_ID, 'STUDENT'));
      mockPrisma.internshipPlan.findUnique.mockResolvedValueOnce({
        id: 'plan-1',
        designationId: 'des-1',
        status: 'PUBLISHED',
        basePrice: 5000,
        discountPercent: 20,
        currency: 'INR',
      });
      mockPrisma.assessmentAttempt.findUnique.mockResolvedValueOnce(null);
      mockPrisma.quote.create.mockResolvedValueOnce({
        id: 'quote-123',
        userId: STUDENT_ID,
        planId: 'plan-1',
        enrollmentType: 'INDIVIDUAL',
        teamId: null,
        attemptId: null,
        basePrice: 5000,
        discountPercent: 20,
        payableAmount: 4000,
        currency: 'INR',
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/enrollments/quote')
        .set('Authorization', bearerFor(STUDENT_ID, 'STUDENT'))
        .send({ planId: 'plan-1' });

      expect(res.status).toBe(201);
      expect(res.body.data.quoteId).toBe('quote-123');
      expect(res.body.data._id).toBe('quote-123');
      expect(res.body.data.discountPercent).toBe(20);
      expect(res.body.data.payableAmount).toBe(4000);
    });
  });

  describe('POST /api/v1/tasks/:id/submissions', () => {
    const validDescription =
      'Implemented the authentication module, wrote unit tests, and verified local build without errors.';

    test('routes submission to PENDING and notifies assigned trainer when requiresTrainerReview is true', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(STUDENT_ID, 'STUDENT'));
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1', userId: STUDENT_ID });
      mockPrisma.taskProgress.findUnique.mockResolvedValueOnce({
        id: 'tp-1',
        enrollmentId: 'enr-1',
        teamId: null,
        taskId: 'td-1',
        status: 'IN_PROGRESS',
        attempts: 0,
        task: {
          id: 'td-1',
          sequence: 1,
          dayNumber: 1,
          title: 'Build Auth API',
          requiresTrainerReview: true,
          prerequisiteTaskIds: [],
        },
        enrollment: {
          id: 'enr-1',
          userId: STUDENT_ID,
          teamId: null,
          status: 'ACTIVE',
          payments: [{ status: 'CAPTURED' }],
          team: null,
        },
      });
      mockPrisma.taskSubmission.create.mockResolvedValueOnce({
        id: 'sub-1',
        taskProgressId: 'tp-1',
        enrollmentId: 'enr-1',
        submittedById: STUDENT_ID,
        submittedBy: { id: STUDENT_ID, name: 'STUDENT User' },
        attemptNumber: 1,
        reviewStatus: 'PENDING',
        githubUrl: 'https://github.com/student/project',
        description: validDescription,
        screenshots: [{ url: '/uploads/mock-screenshot.png' }],
        submittedAt: new Date(),
      });
      mockPrisma.taskProgress.update.mockResolvedValueOnce({
        id: 'tp-1',
        status: 'SUBMITTED',
        attempts: 1,
      });
      mockPrisma.enrollment.update.mockResolvedValueOnce({ id: 'enr-1', status: 'IN_PROGRESS' });
      mockPrisma.trainerAssignment.findFirst.mockResolvedValueOnce({
        id: 'ta-1',
        trainerId: TRAINER_ID,
        trainer: { id: TRAINER_ID, name: 'Mentor Raj', email: 'raj@example.com' },
      });

      const res = await request(app)
        .post('/api/v1/tasks/tp-1/submissions')
        .set('Authorization', bearerFor(STUDENT_ID, 'STUDENT'))
        .field('githubUrl', 'https://github.com/student/project')
        .field('description', validDescription)
        .attach('screenshots', FAKE_PNG, { filename: 'proof.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.data.autoApproved).toBe(false);
      expect(res.body.data.assignedTrainer).toMatchObject({ _id: TRAINER_ID, name: 'Mentor Raj' });
      expect(mockPrisma.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'enr-1' }, data: { status: 'IN_PROGRESS' } }),
      );
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: TRAINER_ID,
            type: 'TASK_SUBMITTED',
          }),
        }),
      );
    });

    test('routes submission to PENDING for trainer review even when legacy task has requiresTrainerReview=false', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(STUDENT_ID, 'STUDENT'));
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1', userId: STUDENT_ID });
      mockPrisma.taskProgress.findUnique.mockResolvedValueOnce({
        id: 'tp-1',
        enrollmentId: 'enr-1',
        teamId: null,
        taskId: 'td-1',
        status: 'IN_PROGRESS',
        attempts: 0,
        task: {
          id: 'td-1',
          sequence: 1,
          dayNumber: 1,
          title: 'Self-Check Setup',
          requiresTrainerReview: false,
          prerequisiteTaskIds: [],
        },
        enrollment: {
          id: 'enr-1',
          userId: STUDENT_ID,
          teamId: null,
          status: 'IN_PROGRESS',
          payments: [{ status: 'CAPTURED' }],
          team: null,
        },
      });
      mockPrisma.taskSubmission.create.mockResolvedValueOnce({
        id: 'sub-2',
        taskProgressId: 'tp-1',
        enrollmentId: 'enr-1',
        submittedById: STUDENT_ID,
        submittedBy: { id: STUDENT_ID, name: 'STUDENT User' },
        attemptNumber: 1,
        reviewStatus: 'PENDING',
        githubUrl: 'https://github.com/student/project',
        description: validDescription,
        screenshots: [{ url: '/uploads/mock-screenshot.png' }],
        submittedAt: new Date(),
      });
      mockPrisma.taskProgress.update.mockResolvedValue({
        id: 'tp-1',
        status: 'SUBMITTED',
        attempts: 1,
      });
      mockPrisma.trainerAssignment.findFirst.mockResolvedValueOnce({
        trainer: { id: TRAINER_ID, name: 'Alex Trainer', email: 'alex@alfre.com' },
      });

      const res = await request(app)
        .post('/api/v1/tasks/tp-1/submissions')
        .set('Authorization', bearerFor(STUDENT_ID, 'STUDENT'))
        .field('githubUrl', 'https://github.com/student/project')
        .field('description', validDescription)
        .attach('screenshots', FAKE_PNG, { filename: 'proof.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.data.autoApproved).toBe(false);
      expect(mockPrisma.taskSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: 'PENDING',
          }),
        }),
      );
      expect(mockPrisma.taskProgress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tp-1' },
          data: expect.objectContaining({
            status: 'SUBMITTED',
            lastReviewStatus: 'PENDING',
          }),
        }),
      );
    });
  });

  describe('Trainer stats and atomic review decisions', () => {
    test('GET /api/v1/trainer/stats returns frontend-aligned stat keys', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(TRAINER_ID, 'TRAINER'));
      mockPrisma.trainerAssignment.findMany.mockResolvedValueOnce([
        { id: 'ta-1', enrollmentId: 'enr-1', teamId: null },
        { id: 'ta-2', enrollmentId: null, teamId: 'team-1' },
      ]);
      mockPrisma.taskSubmission.count.mockResolvedValueOnce(4); // pending
      mockPrisma.taskProgress.count.mockResolvedValueOnce(2); // changesRequested
      mockPrisma.review.count
        .mockResolvedValueOnce(3) // reviewedToday
        .mockResolvedValueOnce(15); // totalReviewed

      const res = await request(app)
        .get('/api/v1/trainer/stats')
        .set('Authorization', bearerFor(TRAINER_ID, 'TRAINER'));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        pending: 4,
        changesRequested: 2,
        reviewedToday: 3,
        assignedStudents: 1,
        assignedTeams: 1,
        activeAssignments: 2,
        pendingSubmissions: 4,
        totalReviewed: 15,
      });
    });

    test('POST /api/v1/trainer/submissions/:id/review supports ESCALATED atomically and notifies admins', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(TRAINER_ID, 'TRAINER'));
      mockPrisma.taskSubmission.findUnique.mockResolvedValueOnce({
        id: 'sub-99',
        enrollmentId: 'enr-1',
        taskProgressId: 'tp-99',
        attemptNumber: 1,
        submittedById: STUDENT_ID,
        submittedBy: { id: STUDENT_ID, name: 'Student', email: 'student@example.com' },
        reviewStatus: 'PENDING',
        taskProgress: {
          id: 'tp-99',
          enrollmentId: 'enr-1',
          teamId: null,
          task: { id: 'td-99', title: 'Security Audit' },
          enrollment: {
            id: 'enr-1',
            user: { id: STUDENT_ID, name: 'Student', email: 'student@example.com' },
            team: null,
          },
        },
      });
      mockPrisma.trainerAssignment.findMany
        .mockResolvedValueOnce([{ enrollmentId: 'enr-1', teamId: null }]) // trainerCanAccessSubmission
        .mockResolvedValueOnce([{ enrollmentId: 'enr-1', teamId: null }]); // findNextPendingForTrainer
      mockPrisma.review.upsert.mockResolvedValueOnce({
        id: 'rev-1',
        decision: 'ESCALATED',
        feedback: 'Suspected plagiarized repository, needs admin review.',
        reviewedAt: new Date(),
        trainer: { id: TRAINER_ID, name: 'TRAINER User' },
      });
      mockPrisma.taskSubmission.update.mockResolvedValueOnce({
        id: 'sub-99',
        reviewStatus: 'ESCALATED',
      });
      mockPrisma.taskProgress.update.mockResolvedValueOnce({
        id: 'tp-99',
        status: 'SUBMITTED',
        lastReviewStatus: 'ESCALATED',
      });
      mockPrisma.user.findMany.mockResolvedValueOnce([{ id: ADMIN_ID }]);
      mockPrisma.taskSubmission.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/trainer/submissions/sub-99/review')
        .set('Authorization', bearerFor(TRAINER_ID, 'TRAINER'))
        .send({
          decision: 'ESCALATED',
          feedback: 'Suspected plagiarized repository, needs admin review.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.review.decision).toBe('ESCALATED');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(addAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUBMISSION_ESCALATED',
          entityId: 'sub-99',
        }),
      );
      expect(mockPrisma.notification.createMany).toHaveBeenCalled();
    });
  });

  describe('Admin trainer revocation security & escalation resolution', () => {
    test('PATCH /api/v1/admin/trainers/:id removes TRAINER role when revoking', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce({
          id: TRAINER_ID,
          name: 'Mentor Raj',
          email: 'raj@example.com',
          status: 'ACTIVE',
          userRoles: [{ role: { name: 'TRAINER' } }],
        })
        .mockResolvedValueOnce({
          id: TRAINER_ID,
          name: 'Mentor Raj',
          email: 'raj@example.com',
          status: 'ACTIVE',
          userRoles: [{ role: { name: 'STUDENT' } }],
        });
      mockPrisma.roleModel.findUnique.mockResolvedValueOnce({ id: 'role-trainer', name: 'TRAINER' });
      mockPrisma.userRole.deleteMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.trainerAssignment.updateMany.mockResolvedValueOnce({ count: 1 });

      const res = await request(app)
        .patch(`/api/v1/admin/trainers/${TRAINER_ID}`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({ isTrainer: false });

      expect(res.status).toBe(200);
      expect(mockPrisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: TRAINER_ID, roleId: 'role-trainer' },
      });
      expect(mockPrisma.trainerAssignment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { trainerId: TRAINER_ID, active: true },
        }),
      );
    });

    test('POST /api/v1/admin/submissions/:id/review resolves ESCALATED submission and notifies student', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'));
      mockPrisma.taskSubmission.findUnique.mockResolvedValueOnce({
        id: 'sub-99',
        enrollmentId: 'enr-1',
        taskProgressId: 'tp-99',
        attemptNumber: 1,
        submittedById: STUDENT_ID,
        submittedBy: { id: STUDENT_ID, name: 'Student', email: 'student@example.com' },
        reviewStatus: 'ESCALATED',
        taskProgress: {
          id: 'tp-99',
          enrollmentId: 'enr-1',
          teamId: null,
          task: { id: 'td-99', title: 'Security Audit' },
          enrollment: {
            id: 'enr-1',
            user: { id: STUDENT_ID, name: 'Student', email: 'student@example.com' },
            team: null,
          },
        },
      });
      mockPrisma.review.upsert.mockResolvedValueOnce({
        id: 'rev-1',
        decision: 'CHANGES_REQUESTED',
        feedback: 'Please cite original sources and rewrite the authentication middleware yourself.',
        reviewedAt: new Date(),
        trainer: { id: ADMIN_ID, name: 'ADMIN User' },
      });
      mockPrisma.taskSubmission.update.mockResolvedValueOnce({
        id: 'sub-99',
        reviewStatus: 'CHANGES_REQUESTED',
      });
      mockPrisma.taskProgress.update.mockResolvedValueOnce({
        id: 'tp-99',
        status: 'CHANGES_REQUESTED',
        lastReviewStatus: 'CHANGES_REQUESTED',
      });

      const res = await request(app)
        .post('/api/v1/admin/submissions/sub-99/review')
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({
          decision: 'CHANGES_REQUESTED',
          feedback: 'Please cite original sources and rewrite the authentication middleware yourself.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.review.decision).toBe('CHANGES_REQUESTED');
      expect(mockPrisma.notification.createMany).toHaveBeenCalled();
    });
  });
});
