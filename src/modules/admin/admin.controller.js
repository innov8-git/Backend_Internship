const crypto = require('crypto');
const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  noContent,
  parsePagination,
  buildOrderBy,
  paginatedResponse,
  buildDateRangeFilter,
  hashPassword,
} = require('../../utils');
const {
  ROLES,
  ROLE_LIST,
  USER_STATUS,
  PAYMENT_STATUS,
  ENROLLMENT_STATUS,
  CERTIFICATE_STATUS,
  EMAIL_STATUS,
  REVIEW_STATUS,
  TEAM_STATUS,
  TASK_STATUS,
} = require('../../common/constants');
const { addAudit } = require('../audit-log/audit-log.service');
const { getStorage } = require('../../libs/storage');
const { streamResumeFile } = require('../trainer-applications/trainer-applications.controller');
const { sendCertificateIssuedEmail, sendTrainerWelcomeEmail } = require('../../libs/email');
const { invalidateAuthUserCache } = require('../../common/guards');
const {
  buildTrainerAssignmentsReport,
  buildTrainerSubmissionWhere,
  executeSubmissionReview,
} = require('../trainer/trainer.controller');
const {
  createNotification,
  createNotificationsForUsers,
} = require('../notifications/services/notifications.service');
const logger = require('../../libs/logger');

function userDto(user) {
  if (!user) return null;
  const roles =
    user.roles ||
    (Array.isArray(user.userRoles)
      ? user.userRoles.map((ur) => ur.role?.name).filter(Boolean)
      : []);

  let assignedTrainer = null;
  const isStudent = roles.includes(ROLES.STUDENT);
  if (isStudent && user.enrollments !== undefined) {
    const enrollments = user.enrollments || [];
    let foundAssignment = null;
    let foundEnrollment = null;

    for (const e of enrollments) {
      const direct = e.trainerAssignments?.find((a) => a.active && a.trainer);
      if (direct) {
        foundAssignment = direct;
        foundEnrollment = e;
        break;
      }
      const team = e.team?.trainerAssignments?.find((a) => a.active && a.trainer);
      if (team) {
        foundAssignment = team;
        foundEnrollment = e;
        break;
      }
    }

    if (foundAssignment && foundAssignment.trainer) {
      assignedTrainer = {
        assigned: true,
        assignmentId: foundAssignment.id,
        trainerId: foundAssignment.trainerId,
        trainer: {
          _id: foundAssignment.trainer.id,
          id: foundAssignment.trainer.id,
          name: foundAssignment.trainer.name,
          email: foundAssignment.trainer.email,
        },
        enrollmentId: foundEnrollment.id,
        teamId: foundAssignment.teamId || null,
        assignedAt: foundAssignment.assignedAt,
      };
    } else {
      const activeEnrollment =
        enrollments.find((e) => e.status !== 'CANCELLED') || enrollments[0];
      assignedTrainer = {
        assigned: false,
        trainer: null,
        trainerId: null,
        assignmentId: null,
        enrollmentId: activeEnrollment?.id || null,
      };
    }
  }

  return {
    _id: user.id,
    name: user.name,
    email: user.email,
    roles,
    status: user.status,
    emailVerified: user.emailVerified,
    ...(user.referredByTpo
      ? {
          referredByTpo: {
            _id: user.referredByTpo.id,
            name: user.referredByTpo.name,
            college: user.referredByTpo.college,
            referralCode: user.referredByTpo.referralCode,
          },
        }
      : user.referralCodeUsed
        ? { referralCodeUsed: user.referralCodeUsed }
        : {}),
    ...(assignedTrainer !== null && { assignedTrainer }),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

const getAdminStats = asyncHandler(async (_req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Run all aggregate/list queries in parallel across the connection pool
  const [users, enrollments, payments, certificates, pendingSubmissions, escalatedSubmissions, unassignedPending] = await Promise.all([
    prisma.user.findMany({
      select: {
        status: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    }),
    prisma.enrollment.findMany({
      select: {
        id: true,
        status: true,
        projectId: true,
        plan: { select: { designation: { select: { name: true } } } },
        trainerAssignments: { where: { active: true }, select: { id: true } },
        team: {
          select: {
            trainerAssignments: { where: { active: true }, select: { id: true } },
          },
        },
      },
    }),
    prisma.payment.findMany({
      select: { amount: true, status: true, flagged: true, createdAt: true, updatedAt: true },
    }),
    prisma.certificate.findMany({
      select: { status: true, emailStatus: true },
    }),
    prisma.taskSubmission.count({
      where: { reviewStatus: REVIEW_STATUS.PENDING },
    }),
    prisma.taskSubmission.count({
      where: { reviewStatus: REVIEW_STATUS.ESCALATED },
    }),
    prisma.taskSubmission.count({
      where: {
        reviewStatus: REVIEW_STATUS.PENDING,
        taskProgress: {
          enrollment: {
            trainerAssignments: { none: { active: true } },
            OR: [
              { teamId: null },
              { team: { trainerAssignments: { none: { active: true } } } },
            ],
          },
        },
      },
    }),
  ]);

  const successfulPayments = payments.filter((p) => p.status === PAYMENT_STATUS.SUCCESS);
  const totalRevenue = successfulPayments.reduce((sum, p) => sum + p.amount, 0);
  const revenue30Days = successfulPayments
    .filter((p) => new Date(p.updatedAt || p.createdAt) >= thirtyDaysAgo)
    .reduce((sum, p) => sum + p.amount, 0);

  const byDesignation = new Map();
  enrollments.forEach((e) => {
    if (e.status === ENROLLMENT_STATUS.CANCELLED) return;
    const name = e.plan?.designation?.name || 'Unknown';
    byDesignation.set(name, (byDesignation.get(name) || 0) + 1);
  });

  // Recent 6 months revenue
  const monthKeys = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthKeys.push(key);
  }

  const revenueByMonth = monthKeys.map((month) => {
    const amount = successfulPayments
      .filter((p) => {
        const d = new Date(p.updatedAt || p.createdAt);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return k === month;
      })
      .reduce((sum, p) => sum + p.amount, 0);
    return { month, amount };
  });

  const enrollmentsByDesignation = [...byDesignation.entries()]
    .map(([designation, count]) => ({ designation, count }))
    .sort((a, b) => b.count - a.count || a.designation.localeCompare(b.designation));

  const hasRole = (u, roleName) =>
    Array.isArray(u.userRoles) && u.userRoles.some((ur) => ur.role?.name === roleName);

  const liveEnrollments = enrollments.filter((e) =>
    [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.IN_PROGRESS].includes(e.status),
  );
  const unassignedProject = liveEnrollments.filter((e) => !e.projectId).length;
  const unassignedTrainer = liveEnrollments.filter(
    (e) =>
      (e.trainerAssignments?.length || 0) === 0 &&
      (e.team?.trainerAssignments?.length || 0) === 0,
  ).length;

  ok(res, {
    users: {
      total: users.length,
      students: users.filter((u) => hasRole(u, ROLES.STUDENT)).length,
      trainers: users.filter((u) => hasRole(u, ROLES.TRAINER)).length,
      admins: users.filter((u) => hasRole(u, ROLES.ADMIN)).length,
      suspended: users.filter((u) => u.status === USER_STATUS.SUSPENDED).length,
    },
    enrollments: {
      total: enrollments.length,
      pendingPayment: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.PENDING_PAYMENT).length,
      active: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.ACTIVE).length,
      inProgress: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.IN_PROGRESS).length,
      completed: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.COMPLETED).length,
      cancelled: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.CANCELLED).length,
      unassignedProject,
      unassignedTrainer,
    },
    revenue: {
      total: totalRevenue,
      last30Days: revenue30Days,
      currency: 'INR',
    },
    payments: {
      success: successfulPayments.length,
      failed: payments.filter((p) => p.status === PAYMENT_STATUS.FAILED).length,
      pending: payments.filter((p) => p.status === PAYMENT_STATUS.PENDING).length,
      flagged: payments.filter((p) => Boolean(p.flagged)).length,
    },
    certificates: {
      issued: certificates.filter((c) => c.status === CERTIFICATE_STATUS.ISSUED).length,
      revoked: certificates.filter((c) => c.status === CERTIFICATE_STATUS.REVOKED).length,
      emailFailed: certificates.filter((c) => c.emailStatus === EMAIL_STATUS.FAILED).length,
    },
    submissions: {
      pending: pendingSubmissions,
      escalated: escalatedSubmissions,
      unassignedPending,
    },
    revenueByMonth,
    enrollmentsByDesignation,
  });
});

// ─── User Management ─────────────────────────────────────────────────────────

const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, role, status, trainerAssignment } = req.query;

  const where = {
    ...(status && { status }),
    ...(role && {
      userRoles: {
        some: {
          role: {
            name: role,
          },
        },
      },
    }),
    ...(search && {
      OR: [
        { name: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ],
    }),
  };

  if (trainerAssignment === 'assigned') {
    where.AND = where.AND || [];
    where.AND.push(
      {
        userRoles: {
          some: {
            role: {
              name: ROLES.STUDENT,
            },
          },
        },
      },
      {
        enrollments: {
          some: {
            OR: [
              {
                trainerAssignments: {
                  some: {
                    active: true,
                  },
                },
              },
              {
                team: {
                  trainerAssignments: {
                    some: {
                      active: true,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    );
  } else if (trainerAssignment === 'unassigned') {
    where.AND = where.AND || [];
    where.AND.push(
      {
        userRoles: {
          some: {
            role: {
              name: ROLES.STUDENT,
            },
          },
        },
      },
      {
        enrollments: {
          none: {
            OR: [
              {
                trainerAssignments: {
                  some: {
                    active: true,
                  },
                },
              },
              {
                team: {
                  trainerAssignments: {
                    some: {
                      active: true,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    );
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        referredByTpo: {
          select: { id: true, name: true, college: true, referralCode: true },
        },
        userRoles: {
          include: {
            role: true,
          },
        },
        enrollments: {
          include: {
            team: {
              include: {
                trainerAssignments: {
                  where: { active: true },
                  include: {
                    trainer: { select: { id: true, name: true, email: true } },
                  },
                },
              },
            },
            trainerAssignments: {
              where: { active: true },
              include: {
                trainer: { select: { id: true, name: true, email: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(users.map(userDto), total, page, limit));
});

const updateUserRoles = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { roles } = req.body;

  if (!Array.isArray(roles) || roles.length === 0) {
    throw ApiError.validationError([{ field: 'roles', message: 'Choose at least one role.' }]);
  }

  const invalidRole = roles.find((r) => !ROLE_LIST.includes(r));
  if (invalidRole) {
    throw ApiError.validationError([{ field: 'roles', message: `Invalid role: ${invalidRole}` }]);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    include: {
      userRoles: {
        include: { role: true },
      },
    },
  });
  if (!targetUser) throw ApiError.notFound('User not found.');

  // Admin cannot remove their own ADMIN role
  if (targetUser.id === req.user.id && !roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', 'You cannot remove your own administrator role.');
  }

  // Find Role records for the requested role names
  const roleRecords = await prisma.roleModel.findMany({
    where: { name: { in: roles } },
  });

  // Sync userRoles in a transaction
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.createMany({
      data: roleRecords.map((r) => ({
        userId: id,
        roleId: r.id,
      })),
    }),
  ]);

  // Invalidate cached auth permissions for this user
  invalidateAuthUserCache(id);

  const updated = await prisma.user.findUnique({
    where: { id },
    include: {
      userRoles: {
        include: { role: true },
      },
      enrollments: {
        include: {
          team: {
            include: {
              trainerAssignments: {
                where: { active: true },
                include: { trainer: { select: { id: true, name: true, email: true } } },
              },
            },
          },
          trainerAssignments: {
            where: { active: true },
            include: { trainer: { select: { id: true, name: true, email: true } } },
          },
        },
      },
    },
  });

  const previousRoles = targetUser.userRoles.map((ur) => ur.role?.name).filter(Boolean);
  const nextRoles = updated.userRoles.map((ur) => ur.role?.name).filter(Boolean);

  await addAudit({
    actorId: req.user.id,
    action: 'USER_ROLES_UPDATED',
    entityType: 'User',
    entityId: updated.id,
    before: { roles: previousRoles },
    after: { roles: nextRoles },
    ip: req.ip,
  });

  ok(res, userDto(updated));
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (![USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED].includes(status)) {
    throw ApiError.validationError([
      { field: 'status', message: 'Status must be ACTIVE or SUSPENDED.' },
    ]);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    include: {
      userRoles: {
        include: { role: true },
      },
    },
  });
  if (!targetUser) throw ApiError.notFound('User not found.');

  if (targetUser.id === req.user.id) {
    throw ApiError.forbidden('FORBIDDEN', 'You cannot suspend your own account.');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status },
    include: {
      userRoles: {
        include: { role: true },
      },
      enrollments: {
        include: {
          team: {
            include: {
              trainerAssignments: {
                where: { active: true },
                include: { trainer: { select: { id: true, name: true, email: true } } },
              },
            },
          },
          trainerAssignments: {
            where: { active: true },
            include: { trainer: { select: { id: true, name: true, email: true } } },
          },
        },
      },
    },
  });

  // Invalidate auth cache so the status change takes effect immediately
  invalidateAuthUserCache(id);

  await addAudit({
    actorId: req.user.id,
    action: `USER_${status === USER_STATUS.SUSPENDED ? 'SUSPENDED' : 'ACTIVATED'}`,
    entityType: 'User',
    entityId: updated.id,
    before: { status: targetUser.status },
    after: { status: updated.status },
    ip: req.ip,
  });

  ok(res, userDto(updated));
});

// ─── Enrollments Management ──────────────────────────────────────────────────

const listAdminEnrollments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, status, enrollmentType, unassigned, designationId, from, to } = req.query;

  const statuses = status
    ? String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const where = {
    ...(statuses.length === 1 && { status: statuses[0] }),
    ...(statuses.length > 1 && { status: { in: statuses } }),
    ...(enrollmentType && { enrollmentType: String(enrollmentType) }),
    ...(unassigned === 'true' && {
      teamId: null,
      trainerAssignments: { none: { active: true } },
    }),
    ...(designationId && { plan: { designationId: String(designationId) } }),
    ...(from || to
      ? {
          createdAt: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }
      : {}),
    ...(search && {
      OR: [
        { user: { name: { contains: String(search), mode: 'insensitive' } } },
        { user: { email: { contains: String(search), mode: 'insensitive' } } },
        { team: { name: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      include: {
        user: true,
        team: true,
        plan: { include: { designation: true, domain: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        trainerAssignments: { where: { active: true }, take: 1, select: { id: true, trainerId: true } },
        taskProgress: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = items.map((e) => {
    const latestPayment = e.payments[0] || null;
    const progress = e.taskProgress || [];
    return {
      _id: e.id,
      userId: e.userId,
      student: { _id: e.user.id, name: e.user.name, email: e.user.email },
      enrollmentType: e.enrollmentType,
      teamId: e.teamId || null,
      team: e.team ? { _id: e.team.id, name: e.team.name } : null,
      planId: e.planId,
      plan: {
        _id: e.plan.id,
        durationMonths: e.plan.durationMonths,
        basePrice: e.plan.basePrice,
        currency: e.plan.currency,
        designation: e.plan.designation
          ? {
              _id: e.plan.designation.id,
              name: e.priceSnapshot?.designationName || e.plan.designation.name,
            }
          : e.priceSnapshot?.designationName
            ? { _id: null, name: e.priceSnapshot.designationName }
            : null,
        domain: e.plan.domain ? { _id: e.plan.domain.id, name: e.plan.domain.name } : null,
      },
      status: e.status,
      hasTrainer: (e.trainerAssignments?.length ?? 0) > 0,
      paymentStatus: latestPayment?.status || null,
      priceSnapshot: e.priceSnapshot,
      progress: {
        approved: progress.filter((p) => p.status === TASK_STATUS.APPROVED).length,
        total: progress.length,
      },
      createdAt: e.createdAt,
      activatedAt: e.activatedAt,
      completedAt: e.completedAt,
    };
  });

  ok(res, paginatedResponse(rows, total, page, limit));
});

const getAdminEnrollmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    include: {
      user: true,
      team: {
        include: {
          members: true,
          trainerAssignments: {
            where: { active: true },
            include: { trainer: true },
          },
        },
      },
      plan: { include: { designation: true, domain: true } },
      project: true,
      payments: {
        include: { events: { orderBy: { processedAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      },
      trainerAssignments: {
        where: { active: true },
        include: { trainer: true },
      },
      taskProgress: { include: { task: true } },
      certificate: true,
    },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found.');

  const progress = enrollment.teamId
    ? await prisma.taskProgress.findMany({ where: { teamId: enrollment.teamId }, include: { task: true } })
    : enrollment.taskProgress || [];
  const activeTrainer =
    enrollment.trainerAssignments[0]?.trainer ||
    enrollment.team?.trainerAssignments?.[0]?.trainer ||
    null;

  ok(res, {
    _id: enrollment.id,
    userId: enrollment.userId,
    student: { _id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email },
    teamId: enrollment.teamId || null,
    team: enrollment.team ? { _id: enrollment.team.id, name: enrollment.team.name } : null,
    planId: enrollment.planId,
    plan: {
      _id: enrollment.plan.id,
      durationMonths: enrollment.plan.durationMonths,
      basePrice: enrollment.plan.basePrice,
      currency: enrollment.plan.currency,
      designation: enrollment.plan.designation
        ? {
            _id: enrollment.plan.designation.id,
            name: enrollment.priceSnapshot?.designationName || enrollment.plan.designation.name,
          }
        : enrollment.priceSnapshot?.designationName
          ? { _id: null, name: enrollment.priceSnapshot.designationName }
          : null,
      domain: enrollment.plan.domain ? { _id: enrollment.plan.domain.id, name: enrollment.plan.domain.name } : null,
    },
    status: enrollment.status,
    priceSnapshot: enrollment.priceSnapshot,
    progress: {
      approved: progress.filter((p) => p.status === TASK_STATUS.APPROVED).length,
      total: progress.length,
    },
    payments: enrollment.payments.map((p) => ({
      _id: p.id,
      orderId: p.orderId,
      provider: p.provider,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      gatewayReference: p.gatewayReference,
      flagged: p.flagged,
      flagReason: p.flagReason,
      createdAt: p.createdAt,
      events: p.events.map((ev) => ({
        _id: ev.id,
        type: ev.type,
        processedAt: ev.processedAt,
        payload: ev.payload,
        note: ev.note,
      })),
    })),
    trainer: activeTrainer ? { _id: activeTrainer.id, name: activeTrainer.name, email: activeTrainer.email } : null,
    project: enrollment.project ? { _id: enrollment.project.id, title: enrollment.project.title, slug: enrollment.project.slug } : null,
    track: enrollment.track || 'web',
    certificate: enrollment.certificate ? { _id: enrollment.certificate.id, certificateNo: enrollment.certificate.certificateNo, status: enrollment.certificate.status } : null,
    createdAt: enrollment.createdAt,
    activatedAt: enrollment.activatedAt,
    completedAt: enrollment.completedAt,
  });
});

// ─── Payments Management ─────────────────────────────────────────────────────

const listAdminPayments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, status, flagged, from, to } = req.query;

  const isFlagged = flagged === 'true' ? true : flagged === 'false' ? false : undefined;

  const where = {
    ...(status && { status }),
    ...(isFlagged !== undefined && { flagged: isFlagged }),
    ...(from || to
      ? {
          createdAt: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }
      : {}),
    ...(search && {
      OR: [
        { orderId: { contains: String(search), mode: 'insensitive' } },
        { user: { name: { contains: String(search), mode: 'insensitive' } } },
        { user: { email: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        enrollment: {
          include: {
            plan: { include: { designation: true, domain: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = items.map((p) => ({
    _id: p.id,
    orderId: p.orderId,
    enrollmentId: p.enrollmentId,
    provider: p.provider,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    gatewayReference: p.gatewayReference,
    flagged: p.flagged,
    flagReason: p.flagReason,
    createdAt: p.createdAt,
    student: p.user ? { _id: p.user.id, name: p.user.name, email: p.user.email } : null,
    plan: p.enrollment?.plan
      ? {
          _id: p.enrollment.plan.id,
          designation: p.enrollment.plan.designation ? { _id: p.enrollment.plan.designation.id, name: p.enrollment.plan.designation.name } : null,
          domain: p.enrollment.plan.domain ? { _id: p.enrollment.plan.domain.id, name: p.enrollment.plan.domain.name } : null,
          durationMonths: p.enrollment.plan.durationMonths,
        }
      : null,
  }));

  ok(res, paginatedResponse(rows, total, page, limit));
});

const getAdminPaymentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      events: { orderBy: { processedAt: 'asc' } },
      enrollment: {
        include: {
          plan: { include: { designation: true, domain: true } },
        },
      },
    },
  });

  if (!payment) throw ApiError.notFound('Payment not found.');

  ok(res, {
    _id: payment.id,
    orderId: payment.orderId,
    enrollmentId: payment.enrollmentId,
    provider: payment.provider,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    gatewayReference: payment.gatewayReference,
    flagged: payment.flagged,
    flagReason: payment.flagReason,
    createdAt: payment.createdAt,
    student: payment.user ? { _id: payment.user.id, name: payment.user.name, email: payment.user.email } : null,
    events: payment.events.map((ev) => ({
      _id: ev.id,
      type: ev.type,
      processedAt: ev.processedAt,
      payload: ev.payload,
      note: ev.note,
    })),
  });
});

// ─── Revenue Analytics ───────────────────────────────────────────────────────

const getAdminRevenue = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, domainId, durationMonths, projectId, from, to } = req.query;

  // Build the enrollment filter: only enrollments with at least one successful payment
  const enrollmentWhere = {
    payments: { some: { status: PAYMENT_STATUS.SUCCESS } },
    ...(domainId && { plan: { domainId } }),
    ...(durationMonths && { plan: { durationMonths: Number(durationMonths) } }),
    ...(projectId && { projectId }),
    ...(from || to
      ? {
          createdAt: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }
      : {}),
    ...(search && {
      OR: [
        { user: { name: { contains: String(search), mode: 'insensitive' } } },
        { user: { email: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  // Merge domain/duration filters when both are present
  if (domainId && durationMonths) {
    enrollmentWhere.plan = { domainId, durationMonths: Number(durationMonths) };
  }

  const [total, items] = await Promise.all([
    prisma.enrollment.count({ where: enrollmentWhere }),
    prisma.enrollment.findMany({
      where: enrollmentWhere,
      include: {
        user: { select: { id: true, name: true, email: true } },
        plan: {
          include: {
            domain: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
          },
        },
        project: { select: { id: true, title: true } },
        payments: {
          where: { status: PAYMENT_STATUS.SUCCESS },
          select: { amount: true, currency: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = items.map((e) => {
    const paid = e.payments.reduce((sum, p) => sum + p.amount, 0);
    return {
      _id: e.id,
      studentName: e.user?.name || e.user?.email || 'Unknown',
      studentEmail: e.user?.email || '',
      domain: e.plan?.domain?.name || '—',
      domainId: e.plan?.domain?.id || null,
      designation: e.plan?.designation?.name || '—',
      durationMonths: e.plan?.durationMonths || 0,
      project: e.project?.title || '—',
      projectId: e.projectId || null,
      studentPays: paid,
      currency: e.payments[0]?.currency || 'INR',
      enrollDate: e.createdAt,
    };
  });

  // Aggregates for the same filter (without pagination) — totals across all matched enrollments
  const allMatchingEnrollments = await prisma.enrollment.findMany({
    where: enrollmentWhere,
    include: {
      plan: {
        include: {
          domain: { select: { id: true, name: true } },
        },
      },
      project: { select: { id: true, title: true } },
      payments: {
        where: { status: PAYMENT_STATUS.SUCCESS },
        select: { amount: true, currency: true, createdAt: true, updatedAt: true },
      },
    },
  });

  let totalRevenue = 0;
  const revenueByDomain = new Map();
  const revenueByMonth = new Map();
  const revenueByProject = new Map();

  allMatchingEnrollments.forEach((e) => {
    const domainName = e.plan?.domain?.name || 'Unknown';
    const projectTitle = e.project?.title || 'Unassigned Project';
    e.payments.forEach((p) => {
      totalRevenue += p.amount;
      revenueByDomain.set(domainName, (revenueByDomain.get(domainName) || 0) + p.amount);
      revenueByProject.set(projectTitle, (revenueByProject.get(projectTitle) || 0) + p.amount);
      const d = new Date(p.updatedAt || p.createdAt);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      revenueByMonth.set(monthKey, (revenueByMonth.get(monthKey) || 0) + p.amount);
    });
  });

  // Sort months chronologically
  const sortedMonths = [...revenueByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

  // Sort domains by revenue descending
  const domainBreakdown = [...revenueByDomain.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain, amount]) => ({ domain, amount }));

  // Sort projects by revenue descending
  const projectBreakdown = [...revenueByProject.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([project, amount]) => ({ project, amount }));

  // Fetch domain and project option lists for filters
  const [domains, projects] = await Promise.all([
    prisma.domain.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({
      select: { id: true, title: true, domainId: true },
      orderBy: { title: 'asc' },
    }),
  ]);

  ok(res, {
    ...paginatedResponse(rows, total, page, limit),
    summary: {
      totalRevenue,
      currency: 'INR',
      enrollmentCount: allMatchingEnrollments.length,
    },
    revenueByMonth: sortedMonths,
    revenueByDomain: domainBreakdown,
    revenueByProject: projectBreakdown,
    filterOptions: {
      domains: domains.map((d) => ({ value: d.id, label: d.name })),
      projects: projects.map((p) => ({ value: p.id, label: p.title, domainId: p.domainId })),
      durations: [1, 2, 3, 4, 6].map((m) => ({
        value: String(m),
        label: `${m} month${m > 1 ? 's' : ''}`,
      })),
    },
  });
});

// ─── Certificates Management ─────────────────────────────────────────────────

const listAdminCertificates = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, emailStatus, status } = req.query;

  const where = {
    ...(status && { status }),
    ...(emailStatus && { emailStatus }),
    ...(search && {
      OR: [
        { certificateNo: { contains: String(search), mode: 'insensitive' } },
        { user: { name: { contains: String(search), mode: 'insensitive' } } },
        { user: { email: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, certs] = await Promise.all([
    prisma.certificate.count({ where }),
    prisma.certificate.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        enrollment: {
          include: {
            plan: { include: { designation: true, domain: true } },
          },
        },
      },
      orderBy: { issuedAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = certs.map((c) => {
    const plan = c.enrollment?.plan;
    return {
      _id: c.id,
      certificateNo: c.certificateNo,
      status: c.status,
      emailStatus: c.emailStatus,
      issuedAt: c.issuedAt,
      revokedAt: c.revokedAt,
      student: c.user ? { _id: c.user.id, name: c.user.name, email: c.user.email } : null,
      designation: plan?.designation ? { _id: plan.designation.id, name: plan.designation.name } : null,
      domain: plan?.domain ? { _id: plan.domain.id, name: plan.domain.name } : null,
      durationMonths: plan?.durationMonths || null,
      verifyUrl: `/certificates/${c.certificateNo}/verify`,
    };
  });

  ok(res, paginatedResponse(rows, total, page, limit));
});

const resendCertificateEmail = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const certificate = await prisma.certificate.findUnique({
    where: { id },
    include: {
      user: true,
      enrollment: {
        include: {
          plan: { include: { designation: true } },
        },
      },
    },
  });

  if (!certificate) throw ApiError.notFound('Certificate not found.');

  if (certificate.status === CERTIFICATE_STATUS.REVOKED) {
    throw ApiError.conflict('CERTIFICATE_REVOKED', 'Cannot resend email for a revoked certificate.');
  }

  try {
    await sendCertificateIssuedEmail(
      certificate.user.email,
      certificate.user.name,
      certificate.certificateNo,
      certificate.enrollment?.plan?.designation?.name || 'Internship',
    );
    await prisma.certificate.update({
      where: { id: certificate.id },
      data: { emailStatus: EMAIL_STATUS.SENT },
    });
  } catch (err) {
    logger.warn('Failed to resend certificate email:', err.message);
  }

  await addAudit({
    actorId: req.user.id,
    action: 'CERTIFICATE_EMAIL_RESENT',
    entityType: 'Certificate',
    entityId: certificate.id,
    ip: req.ip,
  });

  ok(res, { message: 'Certificate email queued for resending.' });
});

// ─── Audit Logs ──────────────────────────────────────────────────────────────

const listAdminAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 20);
  const { search, actorId, action, entityType, from, to, sort } = req.query;

  const dateFilter = buildDateRangeFilter(from, to, 'createdAt');
  const orderBy = buildOrderBy(sort, 'createdAt:desc', ['createdAt', 'action', 'entityType']);

  const where = {
    ...(actorId && { actorId: String(actorId) }),
    ...(action && { action: { contains: String(action), mode: 'insensitive' } }),
    ...(entityType && { entityType: String(entityType) }),
    ...(dateFilter || {}),
    ...(search && {
      OR: [
        { action: { contains: String(search), mode: 'insensitive' } },
        { entityType: { contains: String(search), mode: 'insensitive' } },
        { actor: { name: { contains: String(search), mode: 'insensitive' } } },
        { actor: { email: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  const rows = logs.map((l) => ({
    _id: l.id,
    actorId: l.actorId,
    actor: l.actor ? { _id: l.actor.id, name: l.actor.name, email: l.actor.email } : null,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    before: l.before,
    after: l.after,
    ip: l.ip,
    createdAt: l.createdAt,
  }));

  ok(res, paginatedResponse(rows, total, page, limit));
});

// ─── Admin Teams Lookup ──────────────────────────────────────────────────────

const listAdminTeams = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 20);
  const { search, status, unassigned } = req.query;

  const where = {
    ...(status && { status }),
    ...(unassigned === 'true' && {
      trainerAssignments: { none: { active: true } },
    }),
    ...(search && {
      OR: [
        { name: { contains: String(search), mode: 'insensitive' } },
        { leader: { name: { contains: String(search), mode: 'insensitive' } } },
        { leader: { email: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, teams] = await Promise.all([
    prisma.team.count({ where }),
    prisma.team.findMany({
      where,
      include: {
        leader: { select: { id: true, name: true, email: true } },
        plan: { include: { designation: true, domain: true } },
        members: { where: { status: 'JOINED' } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = teams.map((t) => ({
    _id: t.id,
    name: t.name,
    status: t.status,
    leader: t.leader ? { _id: t.leader.id, name: t.leader.name, email: t.leader.email } : null,
    membersCount: t.members.length,
    plan: t.plan
      ? {
          _id: t.plan.id,
          designation: t.plan.designation ? { _id: t.plan.designation.id, name: t.plan.designation.name } : null,
          domain: t.plan.domain ? { _id: t.plan.domain.id, name: t.plan.domain.name } : null,
          durationMonths: t.plan.durationMonths,
        }
      : null,
  }));

  ok(res, paginatedResponse(rows, total, page, limit));
});

// ─── Trainer Assignments ─────────────────────────────────────────────────────

const listTrainerAssignments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, active, trainerId } = req.query;

  const isActive = active === 'true' ? true : active === 'false' ? false : undefined;

  const where = {
    ...(trainerId && { trainerId }),
    ...(isActive !== undefined && { active: isActive }),
    ...(search && {
      OR: [
        { trainer: { name: { contains: String(search), mode: 'insensitive' } } },
        { trainer: { email: { contains: String(search), mode: 'insensitive' } } },
        { enrollment: { user: { name: { contains: String(search), mode: 'insensitive' } } } },
        { team: { name: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.trainerAssignment.count({ where }),
    prisma.trainerAssignment.findMany({
      where,
      include: {
        trainer: { select: { id: true, name: true, email: true } },
        enrollment: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            plan: { include: { designation: true, domain: true } },
          },
        },
        team: {
          include: {
            leader: { select: { id: true, name: true, email: true } },
            plan: { include: { designation: true, domain: true } },
            members: { where: { status: 'JOINED' } },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = items.map((a) => ({
    _id: a.id,
    trainerId: a.trainerId,
    trainer: a.trainer ? { _id: a.trainer.id, name: a.trainer.name, email: a.trainer.email } : null,
    targetType: a.teamId ? 'TEAM' : 'INDIVIDUAL',
    enrollmentId: a.enrollmentId,
    enrollment: a.enrollment
      ? {
          _id: a.enrollment.id,
          student: a.enrollment.user ? { _id: a.enrollment.user.id, name: a.enrollment.user.name, email: a.enrollment.user.email } : null,
          plan: a.enrollment.plan
            ? {
                _id: a.enrollment.plan.id,
                designation: a.enrollment.plan.designation ? { _id: a.enrollment.plan.designation.id, name: a.enrollment.plan.designation.name } : null,
                domain: a.enrollment.plan.domain ? { _id: a.enrollment.plan.domain.id, name: a.enrollment.plan.domain.name } : null,
                durationMonths: a.enrollment.plan.durationMonths,
              }
            : null,
        }
      : null,
    teamId: a.teamId,
    team: a.team
      ? {
          _id: a.team.id,
          name: a.team.name,
          leader: a.team.leader ? { _id: a.team.leader.id, name: a.team.leader.name, email: a.team.leader.email } : null,
          membersCount: a.team.members.length,
        }
      : null,
    active: a.active,
    assignedAt: a.assignedAt,
    unassignedAt: a.unassignedAt,
  }));

  ok(res, paginatedResponse(rows, total, page, limit));
});

/**
 * GET /admin/trainer-assignments/summary
 * Overall trainer count, assigned tasks, reviewed tasks and pending tasks for the assignments overview.
 */
const getTrainerAssignmentsSummary = asyncHandler(async (_req, res) => {
  const [totalTrainers, activeAssignments] = await Promise.all([
    prisma.user.count({
      where: {
        status: USER_STATUS.ACTIVE,
        userRoles: { some: { role: { name: ROLES.TRAINER } } },
      },
    }),
    prisma.trainerAssignment.findMany({
      where: { active: true },
      select: { trainerId: true, enrollmentId: true, teamId: true },
    }),
  ]);

  const assignedTrainers = new Set(activeAssignments.map((a) => a.trainerId).filter(Boolean)).size;
  const enrollmentIds = [...new Set(activeAssignments.map((a) => a.enrollmentId).filter(Boolean))];
  const teamIds = [...new Set(activeAssignments.map((a) => a.teamId).filter(Boolean))];

  const progressOr = [];
  if (enrollmentIds.length > 0) progressOr.push({ enrollmentId: { in: enrollmentIds } });
  if (teamIds.length > 0) progressOr.push({ teamId: { in: teamIds } });

  const subOr = buildTrainerSubmissionWhere(enrollmentIds, teamIds);

  const [totalTasks, approvedTasks, totalSubmissions, pendingTasks, reviewedTasks] = await Promise.all([
    progressOr.length > 0
      ? prisma.taskProgress.count({ where: { OR: progressOr } })
      : Promise.resolve(0),
    progressOr.length > 0
      ? prisma.taskProgress.count({ where: { status: TASK_STATUS.APPROVED, OR: progressOr } })
      : Promise.resolve(0),
    subOr.length > 0
      ? prisma.taskSubmission.count({ where: { OR: subOr } })
      : Promise.resolve(0),
    subOr.length > 0
      ? prisma.taskSubmission.count({ where: { reviewStatus: REVIEW_STATUS.PENDING, OR: subOr } })
      : Promise.resolve(0),
    subOr.length > 0
      ? prisma.taskSubmission.count({
          where: { reviewStatus: { not: REVIEW_STATUS.PENDING }, OR: subOr },
        })
      : Promise.resolve(0),
  ]);

  ok(res, {
    totalTrainers,
    assignedTrainers,
    activeAssignments: activeAssignments.length,
    totalTasks,
    approvedTasks,
    totalSubmissions,
    reviewedTasks,
    pendingTasks,
  });
});

/**
 * Shared trainer-assignment logic used by POST /admin/trainer-assignments,
 * POST /admin/trainers/:id/assignments and PATCH /admin/users/:id/trainer.
 * Validates the trainer + target, deactivates the target's previous active
 * assignment (history is kept), creates the new one and writes an audit entry.
 */
async function assignTrainerToTarget({ trainerId, enrollmentId, teamId, actorId, ip, rejectDuplicate = false }) {
  const details = [];
  if (!trainerId) details.push({ field: 'trainerId', message: 'Choose a trainer.' });
  if (!enrollmentId && !teamId) {
    details.push({ field: 'enrollmentId', message: 'Choose a student enrollment or a team.' });
  } else if (enrollmentId && teamId) {
    details.push({ field: 'teamId', message: 'Choose either an enrollment or a team, not both.' });
  }
  if (details.length > 0) throw ApiError.validationError(details);

  const trainer = await prisma.user.findUnique({
    where: { id: trainerId },
    include: {
      userRoles: {
        include: { role: true },
      },
    },
  });
  const isTrainer = trainer && trainer.userRoles.some((ur) => ur.role?.name === ROLES.TRAINER);
  if (!isTrainer) {
    throw ApiError.validationError([{ field: 'trainerId', message: 'User is not a trainer.' }]);
  }

  if (enrollmentId) {
    const e = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!e) throw ApiError.validationError([{ field: 'enrollmentId', message: 'That enrollment no longer exists.' }]);
  }

  if (teamId) {
    const t = await prisma.team.findUnique({ where: { id: teamId } });
    if (!t) throw ApiError.validationError([{ field: 'teamId', message: 'That team no longer exists.' }]);
    if (t.status === TEAM_STATUS.DISBANDED) {
      throw ApiError.validationError([{ field: 'teamId', message: "This team was disbanded, so it can't get a trainer." }]);
    }
  }

  if (rejectDuplicate) {
    const existing = await prisma.trainerAssignment.findFirst({
      where: {
        trainerId,
        active: true,
        ...(enrollmentId ? { enrollmentId } : { teamId }),
      },
    });
    if (existing) {
      throw ApiError.conflict('DUPLICATE_ASSIGNMENT', 'This trainer is already assigned to that target.');
    }
  }

  // Deactivate previous active assignment for the target
  const now = new Date();
  await prisma.trainerAssignment.updateMany({
    where: {
      enrollmentId: enrollmentId || null,
      teamId: teamId || null,
      active: true,
    },
    data: {
      active: false,
      unassignedAt: now,
    },
  });

  const assignment = await prisma.trainerAssignment.create({
    data: {
      trainerId,
      enrollmentId: enrollmentId || null,
      teamId: teamId || null,
      active: true,
      assignedAt: now,
    },
    include: {
      trainer: { select: { id: true, name: true, email: true } },
      enrollment: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          plan: { include: { designation: true, domain: true } },
        },
      },
      team: {
        include: {
          leader: { select: { id: true, name: true, email: true } },
          members: { where: { status: 'JOINED' } },
        },
      },
    },
  });

  await addAudit({
    actorId,
    action: 'TRAINER_ASSIGNED',
    entityType: 'TrainerAssignment',
    entityId: assignment.id,
    after: { trainerId, enrollmentId, teamId },
    ip,
  });

  // Notify trainer and student/team members
  const targetLabel = assignment.team
    ? `team ${assignment.team.name}`
    : assignment.enrollment?.user?.name || 'a student';

  await createNotification({
    userId: trainerId,
    type: 'TRAINER_ASSIGNED',
    title: `New assignment: ${targetLabel}`,
    message: `You have been assigned to review submissions for ${targetLabel}.`,
    link: '/trainer',
    metadata: { assignmentId: assignment.id, enrollmentId: assignment.enrollmentId, teamId: assignment.teamId },
  });

  if (assignment.enrollment?.user?.id) {
    await createNotification({
      userId: assignment.enrollment.user.id,
      type: 'MENTOR_ASSIGNED',
      title: `Mentor assigned: ${assignment.trainer?.name || 'Trainer'}`,
      message: `${assignment.trainer?.name || 'A trainer'} has been assigned as your internship mentor and code reviewer.`,
      link: '/dashboard',
      metadata: { trainerId, enrollmentId: assignment.enrollmentId },
    });
  } else if (assignment.team?.members?.length) {
    const teamUserIds = assignment.team.members.map((m) => m.userId).filter(Boolean);
    await createNotificationsForUsers(teamUserIds, {
      type: 'MENTOR_ASSIGNED',
      title: `Team mentor assigned: ${assignment.trainer?.name || 'Trainer'}`,
      message: `${assignment.trainer?.name || 'A trainer'} has been assigned to review team ${assignment.team.name}.`,
      link: '/dashboard',
      metadata: { trainerId, teamId: assignment.teamId },
    });
  }

  return {
    _id: assignment.id,
    trainerId: assignment.trainerId,
    trainer: assignment.trainer ? { _id: assignment.trainer.id, name: assignment.trainer.name, email: assignment.trainer.email } : null,
    targetType: assignment.teamId ? 'TEAM' : 'INDIVIDUAL',
    enrollmentId: assignment.enrollmentId,
    teamId: assignment.teamId,
    active: assignment.active,
    assignedAt: assignment.assignedAt,
  };
}

const createTrainerAssignment = asyncHandler(async (req, res) => {
  const { trainerId, enrollmentId, teamId } = req.body;
  const dto = await assignTrainerToTarget({
    trainerId,
    enrollmentId,
    teamId,
    actorId: req.user.id,
    ip: req.ip,
  });
  created(res, dto);
});

/**
 * GET /admin/trainers/:id/assignments
 * Active assignments of one trainer (students and teams).
 */
const listTrainerAssignmentsForTrainer = asyncHandler(async (req, res) => {
  const trainerId = req.params.id;
  const trainer = await prisma.user.findUnique({ where: { id: trainerId }, select: { id: true } });
  if (!trainer) throw ApiError.notFound('Trainer');

  const assignments = await prisma.trainerAssignment.findMany({
    where: { trainerId, active: true },
    include: {
      enrollment: { include: { user: { select: { id: true, name: true, email: true } } } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { assignedAt: 'desc' },
  });

  const items = assignments.map((a) => {
    const student = a.enrollment?.user;
    return {
      _id: a.id,
      enrollmentId: a.enrollmentId ?? null,
      teamId: a.teamId ?? null,
      student: student ? { _id: student.id, name: student.name, email: student.email } : null,
      teamName: a.team?.name ?? null,
      assignedAt: a.assignedAt,
    };
  });

  ok(res, { items, total: items.length });
});

/**
 * GET /admin/trainers/:id/reports
 * Full progress report rows (same shape as GET /trainer/assignments) for one trainer.
 */
const getAdminTrainerReports = asyncHandler(async (req, res) => {
  const trainerId = req.params.id;
  const trainer = await prisma.user.findUnique({
    where: { id: trainerId },
    select: { id: true, name: true, email: true },
  });
  if (!trainer) throw ApiError.notFound('Trainer');

  const search = req.query.search ? String(req.query.search).trim() : null;
  const filtered = await buildTrainerAssignmentsReport(trainer.id, search);

  ok(res, {
    ...paginatedResponse(filtered, filtered.length, 1, filtered.length || 10),
    trainer: { _id: trainer.id, name: trainer.name, email: trainer.email },
  });
});

/**
 * POST /admin/trainers/:id/assignments  body: { enrollmentId } | { teamId }
 */
const assignToTrainer = asyncHandler(async (req, res) => {
  const { enrollmentId, teamId } = req.body || {};
  const dto = await assignTrainerToTarget({
    trainerId: req.params.id,
    enrollmentId,
    teamId,
    actorId: req.user.id,
    ip: req.ip,
    rejectDuplicate: true,
  });
  created(res, dto);
});

/**
 * DELETE /admin/trainers/:trainerId/assignments/:assignmentId
 * Soft-deactivates the assignment (history is kept).
 */
const removeTrainerAssignmentForTrainer = asyncHandler(async (req, res) => {
  const { trainerId, assignmentId } = req.params;

  const assignment = await prisma.trainerAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.trainerId !== trainerId) throw ApiError.notFound('Assignment');

  if (assignment.active) {
    await prisma.trainerAssignment.update({
      where: { id: assignmentId },
      data: { active: false, unassignedAt: new Date() },
    });
    await addAudit({
      actorId: req.user.id,
      action: 'TRAINER_UNASSIGNED',
      entityType: 'TrainerAssignment',
      entityId: assignment.id,
      before: { trainerId, enrollmentId: assignment.enrollmentId, teamId: assignment.teamId },
      ip: req.ip,
    });
  }

  ok(res, { success: true });
});

/**
 * PATCH /admin/users/:id/trainer  body: { trainerId?, unassign? }
 * Changes, assigns or removes the trainer of a student's current individual enrollment.
 */
const updateStudentTrainer = asyncHandler(async (req, res) => {
  const studentId = req.params.id;
  const { trainerId, unassign } = req.body || {};
  const isUnassign = unassign === true || unassign === 'true';

  if (!isUnassign && !trainerId) {
    throw ApiError.validationError([{ field: 'trainerId', message: 'Choose a trainer.' }]);
  }

  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { id: true } });
  if (!student) throw ApiError.notFound('User');

  const enrollments = await prisma.enrollment.findMany({
    where: { userId: studentId },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const enrollmentIds = enrollments.map((e) => e.id);

  if (isUnassign) {
    const { count } = await prisma.trainerAssignment.updateMany({
      where: { active: true, enrollmentId: { in: enrollmentIds } },
      data: { active: false, unassignedAt: new Date() },
    });
    if (count > 0) {
      await addAudit({
        actorId: req.user.id,
        action: 'TRAINER_UNASSIGNED',
        entityType: 'User',
        entityId: studentId,
        before: { enrollmentIds },
        ip: req.ip,
      });
    }
    return ok(res, { success: true, assignment: null });
  }

  const preferred = [ENROLLMENT_STATUS.IN_PROGRESS, ENROLLMENT_STATUS.ACTIVE];
  const current =
    enrollments.find((e) => preferred.includes(e.status)) ||
    enrollments.find((e) => e.status !== ENROLLMENT_STATUS.CANCELLED);
  if (!current) {
    throw ApiError.unprocessable(
      'NO_ACTIVE_ENROLLMENT',
      'This student has no enrollment yet, so a trainer cannot be assigned.',
    );
  }

  // Close assignments on the student's other enrollments; the helper closes the current one.
  await prisma.trainerAssignment.updateMany({
    where: { active: true, enrollmentId: { in: enrollmentIds.filter((id) => id !== current.id) } },
    data: { active: false, unassignedAt: new Date() },
  });

  const assignment = await assignTrainerToTarget({
    trainerId,
    enrollmentId: current.id,
    actorId: req.user.id,
    ip: req.ip,
  });

  ok(res, { success: true, assignment });
});

const deleteTrainerAssignment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const assignment = await prisma.trainerAssignment.findUnique({ where: { id } });
  if (!assignment) throw ApiError.notFound('Assignment not found.');

  await prisma.trainerAssignment.update({
    where: { id },
    data: {
      active: false,
      unassignedAt: new Date(),
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'TRAINER_UNASSIGNED',
    entityType: 'TrainerAssignment',
    entityId: assignment.id,
    ip: req.ip,
  });

  noContent(res);
});

// ─── Trainer Management ────────────────────────────────────────────────────────

const listTrainers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, trainerStatus, privilege } = req.query;

  const where = {
    OR: [
      {
        userRoles: {
          some: {
            role: {
              name: ROLES.TRAINER,
            },
          },
        },
      },
      {
        trainerProfile: {
          isNot: null,
        },
      },
    ],
    ...(search && {
      AND: [
        {
          OR: [
            { name: { contains: String(search), mode: 'insensitive' } },
            { email: { contains: String(search), mode: 'insensitive' } },
          ],
        },
      ],
    }),
  };

  const users = await prisma.user.findMany({
    where,
    include: {
      userRoles: {
        include: {
          role: true,
        },
      },
      trainerProfile: true,
      trainerAssignments: {
        where: { active: true },
        include: {
          enrollment: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
          team: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatted = users.map((u) => {
    const activeAssignments = u.trainerAssignments || [];
    const assignedStudentCount = activeAssignments.filter((a) => a.enrollmentId).length;
    const assignedGroupCount = activeAssignments.filter((a) => a.teamId).length;
    const hasTrainerRole = u.userRoles.some((ur) => ur.role?.name === 'TRAINER');
    const isTrainer = hasTrainerRole && (u.trainerProfile?.isApproved !== false);

    const assignments = activeAssignments.map((a) => {
      const student = a.enrollment?.user;
      return {
        _id: a.id,
        id: a.id,
        enrollmentId: a.enrollmentId ?? null,
        teamId: a.teamId ?? null,
        student: student
          ? { _id: student.id, id: student.id, name: student.name, email: student.email }
          : null,
        teamName: a.team?.name ?? null,
        assignedAt: a.assignedAt,
      };
    });

    return {
      _id: u.id,
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone || null,
      status: u.status,
      isTrainer,
      assignedStudentCount,
      assignedGroupCount,
      assignments,
      trainerProfile: u.trainerProfile
        ? {
            domain: u.trainerProfile.domain,
            experience: u.trainerProfile.experience,
            organization: u.trainerProfile.organization || u.organization || null,
            resumeUrl: u.trainerProfile.resumeUrl,
            resumeName: u.trainerProfile.resumeName || (u.trainerProfile.resumeUrl ? 'Resume.pdf' : null),
            resumeSize: u.trainerProfile.resumeSize || null,
            resumeMimeType: u.trainerProfile.resumeMimeType || null,
            linkedinUrl: u.trainerProfile.linkedinUrl || u.linkedinUrl || null,
            bio: u.trainerProfile.bio,
            isApproved: u.trainerProfile.isApproved,
          }
        : null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  });

  let filtered = formatted;
  if (privilege === 'active') {
    filtered = filtered.filter((t) => t.isTrainer);
  } else if (privilege === 'revoked') {
    filtered = filtered.filter((t) => !t.isTrainer);
  }

  if (trainerStatus === 'assigned') {
    filtered = filtered.filter((t) => t.assignedStudentCount + t.assignedGroupCount > 0);
  } else if (trainerStatus === 'unassigned') {
    filtered = filtered.filter((t) => t.assignedStudentCount + t.assignedGroupCount === 0);
  }

  const total = filtered.length;
  const pagedItems = filtered.slice(skip, skip + limit);

  ok(res, paginatedResponse(pagedItems, total, page, limit));
});

const getTrainerResume = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { trainerProfile: true },
  });

  if (!user || !user.trainerProfile) {
    throw ApiError.notFound('Trainer profile not found.');
  }

  const download = req.query.download === '1' || req.query.download === 'true';
  await streamResumeFile(res, user.trainerProfile, { download });
});

const createTrainer = asyncHandler(async (req, res) => {
  const { name, email, phone, password, domain, experience, organization, linkedinUrl, bio, sendEmail = true } = req.body;

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    throw ApiError.conflict('DUPLICATE_EMAIL', 'A user with this email address already exists.', [
      { field: 'email', message: 'This email is already in use.' },
    ]);
  }

  // System generate a secure password if none or empty provided
  const systemGenerated = !password || !password.trim();
  const rawPassword = systemGenerated
    ? `${crypto.randomBytes(5).toString('hex')}A1!`
    : password.trim();

  const passwordHash = await hashPassword(rawPassword);

  const trainerRole = await prisma.roleModel.findUnique({
    where: { name: 'TRAINER' },
  });

  if (!trainerRole) {
    throw ApiError.internal('System role "TRAINER" is not configured.');
  }

  const finalDomain = domain ? domain.trim() : 'General Mentorship';
  const finalExperience = experience ? experience.trim() : '1+ years';
  const finalOrg = organization ? organization.trim() : null;
  const finalLinkedin = linkedinUrl ? linkedinUrl.trim() : null;
  const finalBio = bio ? bio.trim() : null;

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        phone: phone ? phone.trim() : null,
        organization: finalOrg,
        linkedinUrl: finalLinkedin,
        bio: finalBio,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: true,
      },
    });

    await tx.userRole.create({
      data: {
        userId: user.id,
        roleId: trainerRole.id,
      },
    });

    const profile = await tx.trainerProfile.create({
      data: {
        userId: user.id,
        domain: finalDomain,
        experience: finalExperience,
        organization: finalOrg,
        linkedinUrl: finalLinkedin,
        bio: finalBio,
        isApproved: true,
      },
    });

    return { user, profile };
  });

  await addAudit({
    actorId: req.user.id,
    action: 'TRAINER_CREATED',
    entityType: 'User',
    entityId: result.user.id,
    before: null,
    after: {
      name: result.user.name,
      email: result.user.email,
      phone: result.user.phone,
      domain: finalDomain,
      experience: finalExperience,
      organization: finalOrg,
      isApproved: true,
    },
    ip: req.ip,
  });

  // Asynchronously dispatch welcome email with credentials when enabled
  const shouldEmail = sendEmail !== false;
  if (shouldEmail) {
    sendTrainerWelcomeEmail({
      to: result.user.email,
      name: result.user.name,
      email: result.user.email,
      password: rawPassword,
    }).catch((err) => {
      logger.error(`[Admin] Failed to dispatch welcome email to trainer ${result.user.email}: ${err.message}`);
    });
  }

  created(
    res,
    {
      _id: result.user.id,
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      phone: result.user.phone,
      status: result.user.status,
      isTrainer: true,
      trainerProfile: result.profile,
      credentials: {
        email: result.user.email,
        password: rawPassword,
        emailSent: shouldEmail,
      },
    },
    shouldEmail
      ? 'Trainer account created successfully and welcome email dispatched.'
      : 'Trainer account created successfully.',
  );
});

const updateTrainerStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isTrainer } = req.body;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      userRoles: { include: { role: true } },
      trainerProfile: true,
    },
  });

  if (!user) throw ApiError.notFound('Trainer not found.');

  const previousIsTrainer =
    user.userRoles.some((ur) => ur.role?.name === 'TRAINER') && user.trainerProfile?.isApproved !== false;
  const trainerRole = await prisma.roleModel.findUnique({ where: { name: 'TRAINER' } });

  await prisma.$transaction(async (tx) => {
    if (isTrainer) {
      if (trainerRole) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: trainerRole.id } },
          create: { userId: user.id, roleId: trainerRole.id },
          update: {},
        });
      }
      if (user.trainerProfile) {
        await tx.trainerProfile.update({
          where: { userId: user.id },
          data: { isApproved: true },
        });
      }
    } else {
      if (user.trainerProfile) {
        await tx.trainerProfile.update({
          where: { userId: user.id },
          data: { isApproved: false },
        });
      }
      if (trainerRole) {
        await tx.userRole.deleteMany({
          where: { userId: user.id, roleId: trainerRole.id },
        });
      }
      await tx.trainerAssignment.updateMany({
        where: { trainerId: user.id, active: true },
        data: { active: false, unassignedAt: new Date() },
      });
    }
  });

  // Ensure role changes take effect immediately on active JWTs
  invalidateAuthUserCache(user.id);

  await addAudit({
    actorId: req.user.id,
    action: isTrainer ? 'TRAINER_PRIVILEGE_GRANTED' : 'TRAINER_PRIVILEGE_REVOKED',
    entityType: 'User',
    entityId: user.id,
    before: { isTrainer: previousIsTrainer, email: user.email, name: user.name },
    after: { isTrainer: Boolean(isTrainer), email: user.email, name: user.name },
    ip: req.ip,
  });

  ok(res, { _id: user.id, isTrainer: Boolean(isTrainer) }, 'Trainer privilege updated successfully.');
});

/**
 * DELETE /api/v1/admin/trainers/:id
 * Removes a trainer from the Trainers list:
 * - Unassigns all active students/groups, removes TRAINER role, deletes TrainerProfile, revokes active tokens.
 * - Permanently deletes the User row when they have no other roles and no historical records (reviews, enrollments,
 *   payments, certificates, audit logs, submissions, teams); otherwise preserves the User row for referential
 *   integrity (suspending the account if no other roles remain).
 */
const deleteTrainer = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    throw ApiError.badRequest('CANNOT_DELETE_SELF', 'You cannot remove your own account.');
  }

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      userRoles: { include: { role: true } },
      trainerProfile: true,
      _count: {
        select: {
          reviews: true,
          enrollments: true,
          payments: true,
          certificates: true,
          auditLogs: true,
          taskSubmissions: true,
          teamsLed: true,
          teamMemberships: true,
          assessmentAttempts: true,
          quotes: true,
          termsAcceptances: true,
          sopAccessLogs: true,
        },
      },
    },
  });

  if (!user) {
    throw ApiError.notFound('Trainer not found.');
  }

  const roleNames = (user.userRoles || []).map((ur) => ur.role?.name).filter(Boolean);
  const hasTrainerRole = roleNames.includes(ROLES.TRAINER);

  if (!hasTrainerRole && !user.trainerProfile) {
    throw ApiError.badRequest('NOT_A_TRAINER', 'This user is not registered as a trainer.');
  }

  const otherRoles = roleNames.filter((r) => r !== ROLES.TRAINER);
  const counts = user._count || {};
  const hasHistoricalRecords =
    (counts.reviews || 0) > 0 ||
    (counts.enrollments || 0) > 0 ||
    (counts.payments || 0) > 0 ||
    (counts.certificates || 0) > 0 ||
    (counts.auditLogs || 0) > 0 ||
    (counts.taskSubmissions || 0) > 0 ||
    (counts.teamsLed || 0) > 0 ||
    (counts.teamMemberships || 0) > 0 ||
    (counts.assessmentAttempts || 0) > 0 ||
    (counts.quotes || 0) > 0 ||
    (counts.termsAcceptances || 0) > 0 ||
    (counts.sopAccessLogs || 0) > 0;

  const canHardDeleteUser = otherRoles.length === 0 && !hasHistoricalRecords;
  const trainerRole = await prisma.roleModel.findUnique({ where: { name: ROLES.TRAINER } });
  const resumeKeyToDelete = user.trainerProfile?.resumeKey || null;

  const beforeSnapshot = {
    name: user.name,
    email: user.email,
    roles: roleNames,
    status: user.status,
    domain: user.trainerProfile?.domain || null,
    organization: user.trainerProfile?.organization || null,
  };

  await prisma.$transaction(async (tx) => {
    if (canHardDeleteUser) {
      await tx.trainerAssignment.deleteMany({ where: { trainerId: user.id } });
      await tx.githubConnection.deleteMany({ where: { userId: user.id } });
      await tx.user.delete({ where: { id: user.id } });
    } else {
      await tx.trainerAssignment.updateMany({
        where: { trainerId: user.id, active: true },
        data: { active: false, unassignedAt: new Date() },
      });

      if (trainerRole) {
        await tx.userRole.deleteMany({
          where: { userId: user.id, roleId: trainerRole.id },
        });
      }

      if (user.trainerProfile) {
        await tx.trainerProfile.delete({ where: { userId: user.id } });
      }

      await tx.token.updateMany({
        where: { userId: user.id, revoked: false },
        data: { revoked: true },
      });

      if (otherRoles.length === 0) {
        await tx.user.update({
          where: { id: user.id },
          data: { status: USER_STATUS.SUSPENDED },
        });
      }
    }
  });

  invalidateAuthUserCache(user.id);

  if (resumeKeyToDelete) {
    try {
      const storage = getStorage();
      await storage.delete(resumeKeyToDelete, 'raw');
    } catch (err) {
      logger.warn(`Failed to delete trainer resume file ${resumeKeyToDelete}: ${err.message}`);
    }
  }

  await addAudit({
    actorId: req.user.id,
    action: 'TRAINER_REMOVED',
    entityType: 'User',
    entityId: user.id,
    before: beforeSnapshot,
    after: canHardDeleteUser
      ? null
      : {
          removedTrainerProfile: true,
          remainingRoles: otherRoles,
          status: otherRoles.length === 0 ? USER_STATUS.SUSPENDED : user.status,
        },
    ip: req.ip,
  });

  const message = canHardDeleteUser
    ? `Trainer ${user.name} was permanently deleted.`
    : otherRoles.length > 0
      ? `Trainer role and profile removed from ${user.name} (other account roles kept).`
      : `Trainer ${user.name} was removed and suspended (review history preserved).`;

  ok(
    res,
    {
      _id: user.id,
      deletedAccount: canHardDeleteUser,
      remainingRoles: otherRoles,
    },
    message,
  );
});

// ─── Submissions & Escalations Oversight ─────────────────────────────────────

const listAdminSubmissions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 15);
  const { status, unassigned, search } = req.query;
  const onlyUnassigned = unassigned === 'true';

  const andClauses = [];
  if (status) {
    andClauses.push({ reviewStatus: String(status) });
  }
  if (onlyUnassigned) {
    andClauses.push({
      taskProgress: {
        enrollment: {
          trainerAssignments: { none: { active: true } },
          OR: [
            { teamId: null },
            { team: { trainerAssignments: { none: { active: true } } } },
          ],
        },
      },
    });
  }
  if (search) {
    const q = String(search).trim();
    andClauses.push({
      OR: [
        { submittedBy: { name: { contains: q, mode: 'insensitive' } } },
        { submittedBy: { email: { contains: q, mode: 'insensitive' } } },
        { taskProgress: { task: { title: { contains: q, mode: 'insensitive' } } } },
        { taskProgress: { enrollment: { user: { name: { contains: q, mode: 'insensitive' } } } } },
        { taskProgress: { enrollment: { team: { name: { contains: q, mode: 'insensitive' } } } } },
      ],
    });
  }

  const where = andClauses.length > 0 ? { AND: andClauses } : {};

  const [total, submissions] = await Promise.all([
    prisma.taskSubmission.count({ where }),
    prisma.taskSubmission.findMany({
      where,
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        review: { include: { trainer: { select: { id: true, name: true } } } },
        taskProgress: {
          include: {
            task: true,
            enrollment: {
              include: {
                user: { select: { id: true, name: true, email: true } },
                team: {
                  include: {
                    trainerAssignments: {
                      where: { active: true },
                      include: { trainer: { select: { id: true, name: true, email: true } } },
                    },
                  },
                },
                plan: { include: { designation: true, domain: true } },
                project: true,
                trainerAssignments: {
                  where: { active: true },
                  include: { trainer: { select: { id: true, name: true, email: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = submissions.map((s) => {
    const tp = s.taskProgress;
    const enrollment = tp?.enrollment;
    const activeTrainer =
      enrollment?.trainerAssignments?.[0]?.trainer ||
      enrollment?.team?.trainerAssignments?.[0]?.trainer ||
      null;

    return {
      _id: s.id,
      taskProgressId: s.taskProgressId,
      enrollmentId: s.enrollmentId || tp?.enrollmentId || null,
      attemptNumber: s.attemptNumber,
      description: s.description,
      githubUrl: s.githubUrl,
      screenshots: Array.isArray(s.screenshots) ? s.screenshots : [],
      reviewStatus: s.reviewStatus,
      submittedAt: s.submittedAt,
      submittedBy: s.submittedBy
        ? { _id: s.submittedBy.id, name: s.submittedBy.name, email: s.submittedBy.email }
        : null,
      student: enrollment?.user
        ? { _id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email }
        : null,
      team: enrollment?.team ? { _id: enrollment.team.id, name: enrollment.team.name } : null,
      task: tp?.task
        ? { _id: tp.task.id, title: tp.task.title, sequence: tp.task.sequence, dayNumber: tp.task.dayNumber }
        : null,
      plan: enrollment?.plan
        ? {
            _id: enrollment.plan.id,
            durationMonths: enrollment.plan.durationMonths,
            designation: enrollment.plan.designation
        ? {
            _id: enrollment.plan.designation.id,
            name: enrollment.priceSnapshot?.designationName || enrollment.plan.designation.name,
          }
        : enrollment.priceSnapshot?.designationName
          ? { _id: null, name: enrollment.priceSnapshot.designationName }
          : null,
            domain: enrollment.plan.domain ? { _id: enrollment.plan.domain.id, name: enrollment.plan.domain.name } : null,
          }
        : null,
      project: enrollment?.project ? { _id: enrollment.project.id, title: enrollment.project.title } : null,
      assignedTrainer: activeTrainer
        ? { _id: activeTrainer.id, name: activeTrainer.name, email: activeTrainer.email }
        : null,
      review: s.review
        ? {
            _id: s.review.id,
            decision: s.review.decision,
            feedback: s.review.feedback,
            reviewedAt: s.review.reviewedAt,
            trainer: s.review.trainer ? { _id: s.review.trainer.id, name: s.review.trainer.name } : null,
          }
        : null,
    };
  });

  ok(res, paginatedResponse(rows, total, page, limit));
});

const reviewAdminSubmission = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { decision, feedback } = req.body;

  const result = await executeSubmissionReview({
    reviewer: req.user,
    submissionId: id,
    decision,
    feedback,
    ip: req.ip,
    allowAdminOverride: true,
  });

  ok(res, result);
});

module.exports = {
  getAdminStats,
  getAdminRevenue,
  listUsers,
  updateUserRoles,
  updateUserStatus,
  listAdminEnrollments,
  getAdminEnrollmentById,
  listAdminSubmissions,
  reviewAdminSubmission,
  listAdminPayments,
  getAdminPaymentById,
  listAdminCertificates,
  resendCertificateEmail,
  listAdminAuditLogs,
  listAdminTeams,
  listTrainerAssignments,
  getTrainerAssignmentsSummary,
  createTrainerAssignment,
  deleteTrainerAssignment,
  listTrainerAssignmentsForTrainer,
  getAdminTrainerReports,
  assignToTrainer,
  removeTrainerAssignmentForTrainer,
  updateStudentTrainer,
  listTrainers,
  getTrainerResume,
  createTrainer,
  updateTrainerStatus,
  deleteTrainer,
};
