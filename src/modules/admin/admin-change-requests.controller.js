'use strict';

const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const { addAudit } = require('../audit-log/audit-log.service');
const {
  createNotificationsForUsers,
} = require('../notifications/services/notifications.service');
const logger = require('../../libs/logger');

// ─── Admin: List all trainer change requests ─────────────────────────────────

const listTrainerChangeRequests = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const search = req.query.search ? String(req.query.search).trim() : null;
  const status = req.query.status || null;

  const andClauses = [];

  if (status) {
    andClauses.push({ status });
  }

  if (search) {
    andClauses.push({
      OR: [
        { student: { name: { contains: search, mode: 'insensitive' } } },
        { student: { email: { contains: search, mode: 'insensitive' } } },
        { reason: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  const where = andClauses.length > 0 ? { AND: andClauses } : {};

  const [total, requests] = await Promise.all([
    prisma.trainerChangeRequest.count({ where }),
    prisma.trainerChangeRequest.findMany({
      where,
      include: {
        student: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
        enrollment: {
          include: {
            trainerAssignments: {
              where: { active: true },
              include: {
                trainer: { select: { id: true, name: true, email: true } },
              },
              take: 1,
            },
          },
        },
        resolvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const items = requests.map((r) => {
    const activeAssignment = r.enrollment?.trainerAssignments?.[0];
    return {
      _id: r.id,
      studentId: r.studentId,
      studentName: r.student?.name || 'Unknown',
      studentEmail: r.student?.email || '',
      studentPhone: r.mobile || r.student?.phone || '',
      studentAvatar: r.student?.avatarUrl || null,
      enrollmentId: r.enrollmentId,
      currentTrainerId: r.currentTrainerId || activeAssignment?.trainerId || null,
      currentTrainerName: activeAssignment?.trainer?.name || 'Unknown',
      reason: r.reason,
      status: r.status,
      newTrainerId: r.newTrainerId || null,
      resolvedBy: r.resolvedBy ? { _id: r.resolvedBy.id, name: r.resolvedBy.name } : null,
      resolvedAt: r.resolvedAt || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });

  ok(res, paginatedResponse(items, total, page, limit));
});

// ─── Admin: Resolve a trainer change request ─────────────────────────────────

const resolveTrainerChangeRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newTrainerId, status: requestedStatus } = req.body;
  const adminId = req.user.id;

  const changeRequest = await prisma.trainerChangeRequest.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, name: true } },
      enrollment: {
        include: {
          trainerAssignments: { where: { active: true } },
        },
      },
    },
  });

  if (!changeRequest) {
    throw ApiError.notFound('Change request not found.');
  }

  if (changeRequest.status !== 'PENDING') {
    throw ApiError.conflict('ALREADY_RESOLVED', 'This change request has already been resolved.');
  }

  const normalizedStatus = String(requestedStatus || '').toUpperCase();

  if (normalizedStatus === 'APPROVED') {
    if (!newTrainerId) {
      throw ApiError.validationError([
        { field: 'newTrainerId', message: 'Select a new trainer to assign.' },
      ]);
    }

    // Verify new trainer exists and has TRAINER role
    const newTrainer = await prisma.user.findUnique({
      where: { id: newTrainerId },
      include: { userRoles: { include: { role: true } } },
    });

    if (!newTrainer) {
      throw ApiError.notFound('Selected trainer not found.');
    }

    const isTrainer = newTrainer.userRoles.some((ur) => ur.role?.name === 'TRAINER');
    if (!isTrainer) {
      throw ApiError.validationError([
        { field: 'newTrainerId', message: 'Selected user is not a trainer.' },
      ]);
    }

    // Transaction: deactivate old assignments, create new one, update request
    await prisma.$transaction(async (tx) => {
      // Deactivate existing trainer assignments for this enrollment
      await tx.trainerAssignment.updateMany({
        where: { enrollmentId: changeRequest.enrollmentId, active: true },
        data: { active: false, unassignedAt: new Date() },
      });

      // Create new trainer assignment
      await tx.trainerAssignment.create({
        data: {
          trainerId: newTrainerId,
          enrollmentId: changeRequest.enrollmentId,
          active: true,
        },
      });

      // Update the change request
      await tx.trainerChangeRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          newTrainerId,
          resolvedById: adminId,
          resolvedAt: new Date(),
        },
      });
    });

    // Notify student
    try {
      await createNotificationsForUsers([changeRequest.studentId], {
        type: 'TRAINER_CHANGED',
        title: 'Trainer Changed Successfully',
        message: `Your request to change trainer has been approved. A new trainer (${newTrainer.name}) has been assigned.`,
        link: '/dashboard',
        metadata: { changeRequestId: id, newTrainerId },
      });
    } catch (err) {
      logger.warn(`Failed to notify student about trainer change: ${err.message}`);
    }

    await addAudit({
      actorId: adminId,
      action: 'TRAINER_CHANGE_APPROVED',
      entityType: 'TrainerChangeRequest',
      entityId: id,
      before: { status: 'PENDING' },
      after: { status: 'APPROVED', newTrainerId },
      ip: req.ip,
    });

    ok(res, { message: 'Trainer changed successfully.', status: 'APPROVED' });
  } else if (normalizedStatus === 'REJECTED') {
    await prisma.trainerChangeRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    // Notify student
    try {
      await createNotificationsForUsers([changeRequest.studentId], {
        type: 'TRAINER_CHANGE_REJECTED',
        title: 'Trainer Change Request Rejected',
        message: 'Your request to change trainer has been reviewed and was not approved. You will continue with your current trainer.',
        link: '/dashboard',
        metadata: { changeRequestId: id },
      });
    } catch (err) {
      logger.warn(`Failed to notify student about rejection: ${err.message}`);
    }

    await addAudit({
      actorId: adminId,
      action: 'TRAINER_CHANGE_REJECTED',
      entityType: 'TrainerChangeRequest',
      entityId: id,
      before: { status: 'PENDING' },
      after: { status: 'REJECTED' },
      ip: req.ip,
    });

    ok(res, { message: 'Change request rejected.', status: 'REJECTED' });
  } else {
    throw ApiError.validationError([
      { field: 'status', message: 'Status must be APPROVED or REJECTED.' },
    ]);
  }
});

module.exports = {
  listTrainerChangeRequests,
  resolveTrainerChangeRequest,
};

