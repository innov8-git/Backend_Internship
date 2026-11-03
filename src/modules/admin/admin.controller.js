const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  noContent,
  parsePagination,
  parseSort,
  paginatedResponse,
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
} = require('../../common/constants');
const { addAudit } = require('../audit-log/audit-log.service');
const { sendCertificateIssuedEmail } = require('../../libs/email');
const logger = require('../../libs/logger');

function userDto(user) {
  if (!user) return null;
  return {
    _id: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    status: user.status,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

const getAdminStats = asyncHandler(async (_req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const users = await prisma.user.findMany({ select: { roles: true, status: true } });
  const enrollments = await prisma.enrollment.findMany({
    select: {
      status: true,
      plan: { include: { designation: { select: { name: true } } } },
    },
  });
  const payments = await prisma.payment.findMany({
    select: { amount: true, status: true, flagged: true, createdAt: true, updatedAt: true },
  });
  const certificates = await prisma.certificate.findMany({
    select: { status: true, emailStatus: true },
  });
  const pendingSubmissions = await prisma.taskSubmission.count({
    where: { reviewStatus: REVIEW_STATUS.PENDING },
  });

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

  ok(res, {
    users: {
      total: users.length,
      students: users.filter((u) => u.roles.includes(ROLES.STUDENT)).length,
      trainers: users.filter((u) => u.roles.includes(ROLES.TRAINER)).length,
      admins: users.filter((u) => u.roles.includes(ROLES.ADMIN)).length,
      suspended: users.filter((u) => u.status === USER_STATUS.SUSPENDED).length,
    },
    enrollments: {
      total: enrollments.length,
      pendingPayment: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.PENDING_PAYMENT).length,
      active: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.ACTIVE).length,
      inProgress: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.IN_PROGRESS).length,
      completed: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.COMPLETED).length,
      cancelled: enrollments.filter((e) => e.status === ENROLLMENT_STATUS.CANCELLED).length,
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
    },
    revenueByMonth,
    enrollmentsByDesignation,
  });
});

// ─── User Management ─────────────────────────────────────────────────────────

const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, role, status } = req.query;

  const where = {
    ...(status && { status }),
    ...(role && { roles: { has: role } }),
    ...(search && {
      OR: [
        { name: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ],
    }),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
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

  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) throw ApiError.notFound('User not found.');

  // Admin cannot remove their own ADMIN role
  if (targetUser.id === req.user.id && !roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', 'You cannot remove your own administrator role.');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { roles },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'USER_ROLES_UPDATED',
    entityType: 'User',
    entityId: updated.id,
    before: { roles: targetUser.roles },
    after: { roles: updated.roles },
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

  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) throw ApiError.notFound('User not found.');

  if (targetUser.id === req.user.id) {
    throw ApiError.forbidden('FORBIDDEN', 'You cannot suspend your own account.');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status },
  });

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
  const { search, status, designationId, from, to } = req.query;

  const where = {
    ...(status && { status }),
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
      teamId: e.teamId || null,
      team: e.team ? { _id: e.team.id, name: e.team.name } : null,
      planId: e.planId,
      plan: {
        _id: e.plan.id,
        durationMonths: e.plan.durationMonths,
        basePrice: e.plan.basePrice,
        currency: e.plan.currency,
        designation: e.plan.designation ? { _id: e.plan.designation.id, name: e.plan.designation.name } : null,
        domain: e.plan.domain ? { _id: e.plan.domain.id, name: e.plan.domain.name } : null,
      },
      status: e.status,
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
      team: { include: { members: true } },
      plan: { include: { designation: true, domain: true } },
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

  const progress = enrollment.taskProgress || [];
  const activeTrainer = enrollment.trainerAssignments[0]?.trainer || null;

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
      designation: enrollment.plan.designation ? { _id: enrollment.plan.designation.id, name: enrollment.plan.designation.name } : null,
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
  const { search, actorId, action, entityType, from, to } = req.query;

  const where = {
    ...(actorId && { actorId: String(actorId) }),
    ...(action && { action: { contains: String(action), mode: 'insensitive' } }),
    ...(entityType && { entityType: String(entityType) }),
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
      orderBy: { createdAt: 'desc' },
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
  const { search, status } = req.query;

  const where = {
    ...(status && { status }),
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
  const { search, active } = req.query;

  const isActive = active === 'true' ? true : active === 'false' ? false : undefined;

  const where = {
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

const createTrainerAssignment = asyncHandler(async (req, res) => {
  const { trainerId, enrollmentId, teamId } = req.body;

  const details = [];
  if (!trainerId) details.push({ field: 'trainerId', message: 'Choose a trainer.' });
  if (!enrollmentId && !teamId) {
    details.push({ field: 'enrollmentId', message: 'Choose a student enrollment or a team.' });
  } else if (enrollmentId && teamId) {
    details.push({ field: 'teamId', message: 'Choose either an enrollment or a team, not both.' });
  }
  if (details.length > 0) throw ApiError.validationError(details);

  const trainer = await prisma.user.findUnique({ where: { id: trainerId } });
  if (!trainer || !trainer.roles.includes(ROLES.TRAINER)) {
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
    actorId: req.user.id,
    action: 'TRAINER_ASSIGNED',
    entityType: 'TrainerAssignment',
    entityId: assignment.id,
    after: { trainerId, enrollmentId, teamId },
    ip: req.ip,
  });

  created(res, {
    _id: assignment.id,
    trainerId: assignment.trainerId,
    trainer: assignment.trainer ? { _id: assignment.trainer.id, name: assignment.trainer.name, email: assignment.trainer.email } : null,
    targetType: assignment.teamId ? 'TEAM' : 'INDIVIDUAL',
    enrollmentId: assignment.enrollmentId,
    teamId: assignment.teamId,
    active: assignment.active,
    assignedAt: assignment.assignedAt,
  });
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

module.exports = {
  getAdminStats,
  listUsers,
  updateUserRoles,
  updateUserStatus,
  listAdminEnrollments,
  getAdminEnrollmentById,
  listAdminPayments,
  getAdminPaymentById,
  listAdminCertificates,
  resendCertificateEmail,
  listAdminAuditLogs,
  listAdminTeams,
  listTrainerAssignments,
  createTrainerAssignment,
  deleteTrainerAssignment,
};
