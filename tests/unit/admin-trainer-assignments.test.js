'use strict';

process.env.NODE_ENV = 'test';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  enrollment: { findUnique: jest.fn(), findMany: jest.fn() },
  team: { findUnique: jest.fn() },
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
});
