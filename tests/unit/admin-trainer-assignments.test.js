'use strict';

process.env.NODE_ENV = 'test';

const mockPrisma = {
  user: { findUnique: jest.fn(), count: jest.fn() },
  enrollment: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  team: { findUnique: jest.fn() },
  taskProgress: { count: jest.fn() },
  taskSubmission: { count: jest.fn() },
  trainerAssignment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

jest.mock('../../src/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/modules/audit-log/audit-log.service', () => ({
  addAudit: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../src/app');
const { generateAccessToken } = require('../../src/utils');
const { invalidateAuthUserCache } = require('../../src/common/guards');
const { addAudit } = require('../../src/modules/audit-log/audit-log.service');

const ADMIN_ID = 'admin-1';
const STUDENT_ID = 'student-1';
const TRAINER_ID = 'trainer-1';

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
  const token = generateAccessToken({ sub: id, email: `${roleName.toLowerCase()}@example.com`, roles: [roleName] });
  return `Bearer ${token}`;
}

describe('Admin trainer assignment endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAuthUserCache();
  });

  describe('Authorization', () => {
    test('returns 403 for non-admin users', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(STUDENT_ID, 'STUDENT'));

      const res = await request(app)
        .get(`/api/v1/admin/trainers/${TRAINER_ID}/assignments`)
        .set('Authorization', bearerFor(STUDENT_ID, 'STUDENT'));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/admin/trainers/:id/assignments', () => {
    test('returns active student and team assignments for a trainer', async () => {
      const assignedAt = new Date('2026-01-10T10:00:00Z');
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce({ id: TRAINER_ID });
      mockPrisma.trainerAssignment.findMany.mockResolvedValueOnce([
        {
          id: 'ta-1',
          trainerId: TRAINER_ID,
          enrollmentId: 'enr-1',
          teamId: null,
          assignedAt,
          enrollment: { user: { id: STUDENT_ID, name: 'Asha', email: 'asha@example.com' } },
          team: null,
        },
        {
          id: 'ta-2',
          trainerId: TRAINER_ID,
          enrollmentId: null,
          teamId: 'team-1',
          assignedAt,
          enrollment: null,
          team: { id: 'team-1', name: 'Alpha Squad' },
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/admin/trainers/${TRAINER_ID}/assignments`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.items[0]).toMatchObject({
        _id: 'ta-1',
        enrollmentId: 'enr-1',
        teamId: null,
        student: { _id: STUDENT_ID, name: 'Asha', email: 'asha@example.com' },
        teamName: null,
      });
      expect(res.body.data.items[1]).toMatchObject({
        _id: 'ta-2',
        enrollmentId: null,
        teamId: 'team-1',
        student: null,
        teamName: 'Alpha Squad',
      });
    });

    test('returns 404 when trainer does not exist', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/v1/admin/trainers/missing-id/assignments')
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/admin/trainers/:id/assignments', () => {
    test('creates a new assignment and returns 201', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce(makeAuthUser(TRAINER_ID, 'TRAINER'));
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1', userId: STUDENT_ID });
      mockPrisma.trainerAssignment.findFirst.mockResolvedValueOnce(null);
      mockPrisma.trainerAssignment.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.trainerAssignment.create.mockResolvedValueOnce({
        id: 'ta-new',
        trainerId: TRAINER_ID,
        enrollmentId: 'enr-1',
        teamId: null,
        active: true,
        assignedAt: new Date(),
        trainer: { id: TRAINER_ID, name: 'TRAINER User', email: 'trainer@example.com' },
      });

      const res = await request(app)
        .post(`/api/v1/admin/trainers/${TRAINER_ID}/assignments`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({ enrollmentId: 'enr-1' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        _id: 'ta-new',
        trainerId: TRAINER_ID,
        enrollmentId: 'enr-1',
        targetType: 'INDIVIDUAL',
        active: true,
      });
      expect(addAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRAINER_ASSIGNED' }));
    });

    test('returns 409 DUPLICATE_ASSIGNMENT if trainer is already assigned to target', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce(makeAuthUser(TRAINER_ID, 'TRAINER'));
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
      mockPrisma.trainerAssignment.findFirst.mockResolvedValueOnce({ id: 'ta-existing' });

      const res = await request(app)
        .post(`/api/v1/admin/trainers/${TRAINER_ID}/assignments`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({ enrollmentId: 'enr-1' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_ASSIGNMENT');
    });

    test('returns 422 when user is not a trainer', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce(makeAuthUser(STUDENT_ID, 'STUDENT'));

      const res = await request(app)
        .post(`/api/v1/admin/trainers/${STUDENT_ID}/assignments`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({ enrollmentId: 'enr-1' });

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/v1/admin/trainers/:trainerId/assignments/:assignmentId', () => {
    test('soft-deactivates assignment owned by trainer', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'));
      mockPrisma.trainerAssignment.findUnique.mockResolvedValueOnce({
        id: 'ta-1',
        trainerId: TRAINER_ID,
        enrollmentId: 'enr-1',
        teamId: null,
        active: true,
      });
      mockPrisma.trainerAssignment.update.mockResolvedValueOnce({});

      const res = await request(app)
        .delete(`/api/v1/admin/trainers/${TRAINER_ID}/assignments/ta-1`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true });
      expect(mockPrisma.trainerAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ta-1' },
          data: expect.objectContaining({ active: false }),
        }),
      );
      expect(addAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRAINER_UNASSIGNED' }));
    });

    test('returns 404 if assignment belongs to a different trainer', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'));
      mockPrisma.trainerAssignment.findUnique.mockResolvedValueOnce({
        id: 'ta-1',
        trainerId: 'other-trainer',
        active: true,
      });

      const res = await request(app)
        .delete(`/api/v1/admin/trainers/${TRAINER_ID}/assignments/ta-1`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/admin/users/:id/trainer', () => {
    test('assigns trainer to student current IN_PROGRESS enrollment', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce({ id: STUDENT_ID })
        .mockResolvedValueOnce(makeAuthUser(TRAINER_ID, 'TRAINER'));
      mockPrisma.enrollment.findMany.mockResolvedValueOnce([
        { id: 'enr-active', status: 'IN_PROGRESS', createdAt: new Date() },
      ]);
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'enr-active' });
      mockPrisma.trainerAssignment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.trainerAssignment.create.mockResolvedValueOnce({
        id: 'ta-9',
        trainerId: TRAINER_ID,
        enrollmentId: 'enr-active',
        teamId: null,
        active: true,
        assignedAt: new Date(),
        trainer: { id: TRAINER_ID, name: 'TRAINER User', email: 'trainer@example.com' },
      });

      const res = await request(app)
        .patch(`/api/v1/admin/users/${STUDENT_ID}/trainer`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({ trainerId: TRAINER_ID });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.assignment._id).toBe('ta-9');
    });

    test('returns 422 NO_ACTIVE_ENROLLMENT when student has no enrollment', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce({ id: STUDENT_ID });
      mockPrisma.enrollment.findMany.mockResolvedValueOnce([]);

      const res = await request(app)
        .patch(`/api/v1/admin/users/${STUDENT_ID}/trainer`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({ trainerId: TRAINER_ID });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NO_ACTIVE_ENROLLMENT');
    });

    test('unassigns active trainer from student enrollments', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce({ id: STUDENT_ID });
      mockPrisma.enrollment.findMany.mockResolvedValueOnce([
        { id: 'enr-1', status: 'IN_PROGRESS', createdAt: new Date() },
      ]);
      mockPrisma.trainerAssignment.updateMany.mockResolvedValueOnce({ count: 1 });

      const res = await request(app)
        .patch(`/api/v1/admin/users/${STUDENT_ID}/trainer`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'))
        .send({ unassign: true });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true, assignment: null });
      expect(addAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRAINER_UNASSIGNED' }));
    });
  });

  describe('GET /api/v1/admin/trainers/:id/reports', () => {
    test('returns 404 when trainer does not exist', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/api/v1/admin/trainers/missing-id/reports`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(404);
    });

    test('returns trainer info and assignment progress rows for admin', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
        .mockResolvedValueOnce({
          id: TRAINER_ID,
          name: 'Gayatri Patil',
          email: 'gayupatil2108@gmail.com',
        });

      mockPrisma.trainerAssignment.findMany.mockResolvedValueOnce([
        {
          id: 'assign-1',
          trainerId: TRAINER_ID,
          enrollmentId: 'enr-1',
          teamId: null,
          assignedAt: new Date('2026-11-25T10:00:00Z'),
          enrollment: {
            id: 'enr-1',
            track: 'web',
            activatedAt: new Date('2026-11-25T10:00:00Z'),
            user: { id: 'stu-1', name: 'Kedar Deshmukh', email: 'kedar@example.com' },
            plan: {
              id: 'plan-1',
              durationMonths: 3,
              designation: { id: 'des-1', name: 'Java Developer' },
              domain: { id: 'dom-1', name: 'Banking' },
            },
            project: { id: 'proj-1', title: 'LedgerCore' },
            taskProgress: [
              { id: 'tp-1', status: 'APPROVED', submissions: [] },
              {
                id: 'tp-2',
                status: 'SUBMITTED',
                submissions: [{ id: 'sub-1', reviewStatus: 'PENDING', submittedAt: new Date() }],
              },
            ],
          },
          team: null,
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/admin/trainers/${TRAINER_ID}/reports`)
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.data.trainer).toEqual({
        _id: TRAINER_ID,
        name: 'Gayatri Patil',
        email: 'gayupatil2108@gmail.com',
      });
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({
        student: { _id: 'stu-1', name: 'Kedar Deshmukh', email: 'kedar@example.com' },
        approvedTasks: 1,
        totalTasks: 2,
        pendingSubmissions: 1,
      });
    });
  });

  describe('GET /api/v1/admin/trainer-assignments/summary', () => {
    test('returns trainer count and overall trainer task counts', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'));
      mockPrisma.user.count.mockResolvedValueOnce(4);
      mockPrisma.trainerAssignment.findMany.mockResolvedValueOnce([
        { trainerId: 't-1', enrollmentId: 'enr-1', teamId: null },
        { trainerId: 't-1', enrollmentId: 'enr-2', teamId: null },
        { trainerId: 't-2', enrollmentId: null, teamId: 'team-1' },
      ]);
      mockPrisma.taskProgress.count
        .mockResolvedValueOnce(15) // totalTasks
        .mockResolvedValueOnce(6); // approvedTasks
      mockPrisma.taskSubmission.count
        .mockResolvedValueOnce(10) // totalSubmissions
        .mockResolvedValueOnce(3) // pendingTasks
        .mockResolvedValueOnce(7); // reviewedTasks

      const res = await request(app)
        .get('/api/v1/admin/trainer-assignments/summary')
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        totalTrainers: 4,
        assignedTrainers: 2,
        activeAssignments: 3,
        totalTasks: 15,
        approvedTasks: 6,
        totalSubmissions: 10,
        reviewedTasks: 7,
        pendingTasks: 3,
      });
    });
  });

  describe('GET /api/v1/admin/enrollments', () => {
    test('returns unassigned active individual enrollments when unassigned=true', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'));
      mockPrisma.enrollment.count.mockResolvedValueOnce(1);
      mockPrisma.enrollment.findMany.mockResolvedValueOnce([
        {
          id: 'enr-unassigned',
          userId: STUDENT_ID,
          teamId: null,
          planId: 'plan-1',
          enrollmentType: 'INDIVIDUAL',
          status: 'ACTIVE',
          priceSnapshot: 1999,
          createdAt: new Date(),
          activatedAt: new Date(),
          completedAt: null,
          user: { id: STUDENT_ID, name: 'Sanika Waske', email: 'sanika@example.com' },
          team: null,
          plan: {
            id: 'plan-1',
            durationMonths: 2,
            basePrice: 1999,
            currency: 'INR',
            designation: { id: 'des-1', name: 'Java Developer' },
            domain: { id: 'dom-1', name: 'Banking' },
          },
          payments: [{ status: 'PAID' }],
          trainerAssignments: [],
          taskProgress: [],
        },
      ]);

      const res = await request(app)
        .get('/api/v1/admin/enrollments?status=ACTIVE,IN_PROGRESS&enrollmentType=INDIVIDUAL&unassigned=true')
        .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

      expect(res.status).toBe(200);
      expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ACTIVE', 'IN_PROGRESS'] },
            enrollmentType: 'INDIVIDUAL',
            teamId: null,
            trainerAssignments: { none: { active: true } },
          }),
        }),
      );
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({
        _id: 'enr-unassigned',
        student: { _id: STUDENT_ID, name: 'Sanika Waske', email: 'sanika@example.com' },
        enrollmentType: 'INDIVIDUAL',
        hasTrainer: false,
      });
    });
  });
});
