'use strict';

process.env.NODE_ENV = 'test';

const mockTx = {
  enrollment: { findMany: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
  team: { findMany: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  teamMember: { count: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  payment: { findMany: jest.fn(), deleteMany: jest.fn() },
  paymentEvent: { deleteMany: jest.fn() },
  taskProgress: { findMany: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
  taskSubmission: { findMany: jest.fn(), deleteMany: jest.fn() },
  review: { deleteMany: jest.fn() },
  sopAccessLog: { deleteMany: jest.fn() },
  trainerAssignment: { deleteMany: jest.fn() },
  tpoEarning: { deleteMany: jest.fn() },
  certificate: { deleteMany: jest.fn() },
  termsAcceptance: { deleteMany: jest.fn() },
  quote: { deleteMany: jest.fn(), updateMany: jest.fn() },
  assessmentAttempt: { deleteMany: jest.fn() },
  githubConnection: { deleteMany: jest.fn() },
  otpToken: { deleteMany: jest.fn() },
  tpo: { update: jest.fn() },
  auditLog: { deleteMany: jest.fn() },
  user: { delete: jest.fn() },
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn(mockTx)),
};

const mockStorageDelete = jest.fn().mockResolvedValue({});

jest.mock('../../src/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/modules/audit-log/audit-log.service', () => ({
  addAudit: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/libs/storage', () => ({
  getStorage: () => ({ delete: mockStorageDelete }),
}));

const request = require('supertest');
const app = require('../../src/app');
const { generateAccessToken } = require('../../src/utils');
const { invalidateAuthUserCache } = require('../../src/common/guards');
const { addAudit } = require('../../src/modules/audit-log/audit-log.service');

const ADMIN_ID = 'admin-1';
const TARGET_USER_ID = 'user-target-1';

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

function setupDefaultTxMocks() {
  mockTx.enrollment.findMany.mockResolvedValue([]);
  mockTx.team.findMany.mockResolvedValue([]);
  mockTx.teamMember.count.mockResolvedValue(0);
  mockTx.payment.findMany.mockResolvedValue([]);
  mockTx.taskProgress.findMany.mockResolvedValue([]);
  mockTx.taskSubmission.findMany.mockResolvedValue([]);
  mockTx.$queryRawUnsafe.mockResolvedValue([{ tbl: null }]);
  mockTx.user.delete.mockResolvedValue({ id: TARGET_USER_ID });
}

describe('DELETE /api/v1/admin/users/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAuthUserCache();
    setupDefaultTxMocks();
  });

  test('returns 403 for non-admin callers', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser('student-1', 'STUDENT'));

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set('Authorization', bearerFor('student-1', 'STUDENT'));

    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('prevents an admin from deleting their own account', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'));

    const res = await request(app)
      .delete(`/api/v1/admin/users/${ADMIN_ID}`)
      .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_DELETE_SELF');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('returns 404 when target user does not exist', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

    expect(res.status).toBe(404);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('prevents deleting the only remaining admin account', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
      .mockResolvedValueOnce({
        id: TARGET_USER_ID,
        name: 'Sole Admin',
        email: 'sole@example.com',
        status: 'ACTIVE',
        userRoles: [{ role: { name: 'ADMIN' } }],
        trainerProfile: null,
        tpoProfile: null,
      });
    mockPrisma.user.count.mockResolvedValueOnce(1);

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_ADMIN');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('hard-deletes a user and all dependent records, transfers team leadership, and logs audit', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
      .mockResolvedValueOnce({
        id: TARGET_USER_ID,
        name: 'Rohan Gupta',
        email: 'leader@demo.dev',
        status: 'ACTIVE',
        userRoles: [{ role: { name: 'STUDENT' } }],
        trainerProfile: { resumeKey: 'resumes/rohan.pdf' },
        tpoProfile: { id: 'tpo-1' },
      });

    mockTx.enrollment.findMany.mockResolvedValueOnce([{ id: 'enr-1' }]);
    mockTx.team.findMany.mockResolvedValueOnce([
      {
        id: 'team-1',
        leaderId: TARGET_USER_ID,
        members: [
          { id: 'tm-1', userId: TARGET_USER_ID, status: 'JOINED' },
          { id: 'tm-2', userId: 'teammate-2', status: 'JOINED' },
        ],
      },
    ]);
    mockTx.teamMember.count.mockResolvedValueOnce(1);
    mockTx.payment.findMany.mockResolvedValueOnce([{ id: 'pay-1' }]);
    mockTx.taskProgress.findMany.mockResolvedValueOnce([{ id: 'tp-1' }]);
    mockTx.taskSubmission.findMany.mockResolvedValueOnce([{ id: 'sub-1' }]);
    mockTx.$queryRawUnsafe.mockResolvedValueOnce([{ tbl: 'trainer_change_requests' }]);

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      _id: TARGET_USER_ID,
      deleted: true,
      wasTeamMember: true,
    });

    // Live-DB trainer_change_requests table cleaned up
    expect(mockTx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    // Dependent tables deleted
    expect(mockTx.review.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.taskSubmission.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.taskProgress.deleteMany).toHaveBeenCalledWith({
      where: { enrollmentId: { in: ['enr-1'] } },
    });
    expect(mockTx.paymentEvent.deleteMany).toHaveBeenCalledWith({
      where: { paymentId: { in: ['pay-1'] } },
    });
    expect(mockTx.payment.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockTx.enrollment.deleteMany).toHaveBeenCalledWith({
      where: { userId: TARGET_USER_ID },
    });
    // Leadership transferred instead of deleting team with another joined member
    expect(mockTx.team.update).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { leaderId: 'teammate-2' },
    });
    expect(mockTx.teamMember.update).toHaveBeenCalledWith({
      where: { id: 'tm-2' },
      data: { isLeader: true },
    });
    expect(mockTx.team.deleteMany).not.toHaveBeenCalled();
    // TPO unlinked, OTP & audit logs cleaned, user deleted
    expect(mockTx.tpo.update).toHaveBeenCalledWith({
      where: { id: 'tpo-1' },
      data: { userId: null, portalEnabled: false },
    });
    expect(mockTx.otpToken.deleteMany).toHaveBeenCalledWith({
      where: { email: 'leader@demo.dev' },
    });
    expect(mockTx.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { actorId: TARGET_USER_ID },
    });
    expect(mockTx.user.delete).toHaveBeenCalledWith({
      where: { id: TARGET_USER_ID },
    });
    // External resume deleted and USER_DELETED audited
    expect(mockStorageDelete).toHaveBeenCalledWith('resumes/rohan.pdf', 'raw');
    expect(addAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: 'USER_DELETED',
        entityType: 'User',
        entityId: TARGET_USER_ID,
        after: null,
      }),
    );
  });

  test('deletes a solo-led team when no other joined member exists', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(makeAuthUser(ADMIN_ID, 'ADMIN'))
      .mockResolvedValueOnce({
        id: TARGET_USER_ID,
        name: 'Solo Leader',
        email: 'solo@demo.dev',
        status: 'ACTIVE',
        userRoles: [{ role: { name: 'STUDENT' } }],
        trainerProfile: null,
        tpoProfile: null,
      });

    mockTx.team.findMany.mockResolvedValueOnce([
      {
        id: 'team-solo',
        leaderId: TARGET_USER_ID,
        members: [{ id: 'tm-solo', userId: TARGET_USER_ID, status: 'JOINED' }],
      },
    ]);

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_USER_ID}`)
      .set('Authorization', bearerFor(ADMIN_ID, 'ADMIN'));

    expect(res.status).toBe(200);
    expect(mockTx.team.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['team-solo'] } },
    });
    expect(mockTx.user.delete).toHaveBeenCalledWith({
      where: { id: TARGET_USER_ID },
    });
  });
});
