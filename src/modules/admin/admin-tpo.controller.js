'use strict';

const crypto = require('crypto');
const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  paginatedResponse,
  hashPassword,
} = require('../../utils');
const {
  ROLES,
  TPO_COMMISSION_TYPE,
  TPO_EARNING_STATUS,
  TPO_PAYOUT_STATUS,
  USER_STATUS,
} = require('../../common/constants');
const { invalidateAuthUserCache } = require('../../common/guards');
const { sendTpoWelcomeEmail } = require('../../libs/email');
const logger = require('../../libs/logger');
const { addAudit } = require('../audit-log/audit-log.service');
const { generateUniqueTpoReferralCode } = require('./services/tpo-code.util');
const {
  ensureTpoRole,
  getTpoMetricsByIds,
  getGlobalTpoSummary,
} = require('../tpo/services/tpo-earnings.service');

function generateSecureTpoPassword() {
  return `Tpo!${crypto.randomBytes(4).toString('hex')}9A`;
}

function tpoDto(tpo, metrics = {}) {
  if (!tpo) return null;
  const verifiedCount = Number(metrics.verified ?? tpo.totalReferences ?? 0);
  const pendingCount = Number(metrics.pending ?? tpo.pendingReferences ?? 0);
  const paidConversions = Number(metrics.paidConversions ?? 0);
  const totalEarnedPaise = Number(metrics.totalEarnedPaise ?? 0);
  const paidOutPaise = Number(metrics.paidOutPaise ?? 0);
  const pendingPayoutPaise = Number(metrics.pendingPayoutPaise ?? 0);
  const reversedAmountPaise = Number(metrics.reversedAmountPaise ?? 0);

  return {
    _id: tpo.id,
    id: tpo.id,
    userId: tpo.userId || null,
    hasPortalAccount: Boolean(tpo.userId),
    portalEnabled: Boolean(tpo.portalEnabled),
    name: tpo.name,
    college: tpo.college,
    email: tpo.email,
    phone: tpo.phone,
    referralCode: tpo.referralCode,
    isActive: Boolean(tpo.isActive),
    commissionType: tpo.commissionType || TPO_COMMISSION_TYPE.FIXED,
    commissionValue: Number(tpo.commissionValue || 0),
    totalReferences: verifiedCount,
    pendingReferences: pendingCount,
    paidConversions,
    totalEarnedPaise,
    paidOutPaise,
    pendingPayoutPaise,
    reversedAmountPaise,
    currency: 'INR',
    createdBy: tpo.createdBy
      ? {
          _id: tpo.createdBy.id,
          id: tpo.createdBy.id,
          name: tpo.createdBy.name,
          email: tpo.createdBy.email,
        }
      : null,
    createdAt: tpo.createdAt,
    updatedAt: tpo.updatedAt,
  };
}

/**
 * GET /api/v1/admin/tpos
 * Lists TPOs with pagination, search, status filter, sorting, referral counts, and live earnings.
 */
const listAdminTpos = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, status, sort } = req.query;

  const where = {
    ...(status === 'active' && { isActive: true }),
    ...(status === 'inactive' && { isActive: false }),
    ...(search && {
      OR: [
        { name: { contains: String(search), mode: 'insensitive' } },
        { college: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { phone: { contains: String(search), mode: 'insensitive' } },
        { referralCode: { contains: String(search), mode: 'insensitive' } },
      ],
    }),
  };

  let sortField = 'createdAt';
  let sortDir = 'desc';
  if (typeof sort === 'string' && sort.includes(':')) {
    const [field, dir] = sort.split(':');
    if (
      [
        'name',
        'college',
        'createdAt',
        'totalReferences',
        'paidConversions',
        'totalEarnedPaise',
        'pendingPayoutPaise',
      ].includes(field)
    ) {
      sortField = field;
    }
    if (dir === 'asc' || dir === 'desc') {
      sortDir = dir;
    }
  }

  const [total, globalSummary] = await Promise.all([
    prisma.tpo.count({ where }),
    getGlobalTpoSummary(prisma),
  ]);

  const computedSortFields = [
    'totalReferences',
    'paidConversions',
    'totalEarnedPaise',
    'pendingPayoutPaise',
  ];

  let items;
  if (computedSortFields.includes(sortField)) {
    const allMatched = await prisma.tpo.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const metricsMap = await getTpoMetricsByIds(
      prisma,
      allMatched.map((t) => t.id),
    );
    const enriched = allMatched.map((t) => tpoDto(t, metricsMap.get(t.id)));
    const factor = sortDir === 'asc' ? 1 : -1;
    enriched.sort(
      (a, b) =>
        (Number(a[sortField] || 0) - Number(b[sortField] || 0)) * factor ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    items = enriched.slice(skip, skip + limit);
  } else {
    const tpos = await prisma.tpo.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { [sortField]: sortDir },
      skip,
      take: limit,
    });
    const metricsMap = await getTpoMetricsByIds(
      prisma,
      tpos.map((t) => t.id),
    );
    items = tpos.map((t) => tpoDto(t, metricsMap.get(t.id)));
  }

  const response = paginatedResponse(items, total, page, limit);
  response.summary = globalSummary;

  ok(res, response);
});

/**
 * POST /api/v1/admin/tpos
 * Creates a new TPO record, generates a unique referral code, configures commission rate,
 * and optionally provisions a private TPO login account with one-time credentials.
 */
const createAdminTpo = asyncHandler(async (req, res) => {
  const {
    name,
    college,
    email,
    phone,
    commissionType = TPO_COMMISSION_TYPE.FIXED,
    commissionValue = 0,
    portalEnabled = true,
    createPortalAccount = true,
    password,
    sendEmail = true,
  } = req.body;

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedCommissionValue = Math.max(0, Math.round(Number(commissionValue) || 0));

  if (
    commissionType === TPO_COMMISSION_TYPE.PERCENTAGE &&
    normalizedCommissionValue > 10000
  ) {
    throw ApiError.validationError([
      { field: 'commissionValue', message: 'Commission percentage cannot exceed 100%.' },
    ]);
  }

  let rawPassword = null;
  let passwordHash = null;
  let tpoRole = null;

  if (createPortalAccount) {
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingUser) {
      throw ApiError.conflict(
        'DUPLICATE_EMAIL',
        'A user account with this email already exists. Use a unique email for the TPO portal account.',
        [{ field: 'email', message: 'This email is already registered to another account.' }],
      );
    }

    rawPassword = password && password.trim() ? password.trim() : generateSecureTpoPassword();
    passwordHash = await hashPassword(rawPassword);
    tpoRole = await ensureTpoRole(prisma);
  }

  let tpo = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referralCode = await generateUniqueTpoReferralCode(prisma, name);
    try {
      tpo = await prisma.$transaction(async (tx) => {
        let portalUserId = null;
        if (createPortalAccount && tpoRole && passwordHash) {
          const portalUser = await tx.user.create({
            data: {
              name: name.trim(),
              email: normalizedEmail,
              phone: phone.trim(),
              college: college.trim(),
              passwordHash,
              status: USER_STATUS.ACTIVE,
              emailVerified: true,
            },
          });

          await tx.userRole.create({
            data: {
              userId: portalUser.id,
              roleId: tpoRole.id,
            },
          });

          portalUserId = portalUser.id;
        }

        return tx.tpo.create({
          data: {
            userId: portalUserId,
            name: name.trim(),
            college: college.trim(),
            email: normalizedEmail,
            phone: phone.trim(),
            referralCode,
            isActive: true,
            portalEnabled: Boolean(portalEnabled),
            commissionType,
            commissionValue: normalizedCommissionValue,
            createdById: req.user.id,
          },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        });
      });
      break;
    } catch (err) {
      if (err?.code === 'P2002' && attempt < 2) {
        const target = Array.isArray(err?.meta?.target) ? err.meta.target : [];
        if (target.includes('email')) {
          throw ApiError.conflict(
            'DUPLICATE_EMAIL',
            'A user account with this email already exists.',
            [{ field: 'email', message: 'This email is already in use.' }],
          );
        }
        continue;
      }
      throw err;
    }
  }

  const shouldEmail = Boolean(createPortalAccount && rawPassword && sendEmail !== false);
  if (shouldEmail) {
    sendTpoWelcomeEmail({
      to: tpo.email,
      name: tpo.name,
      college: tpo.college,
      referralCode: tpo.referralCode,
      email: tpo.email,
      password: rawPassword,
    }).catch((err) => {
      logger.warn(`[Admin] Failed to send TPO welcome email to ${tpo.email}: ${err.message}`);
    });
  }

  const dto = tpoDto(tpo);
  if (createPortalAccount && rawPassword) {
    dto.credentials = {
      email: tpo.email,
      password: rawPassword,
      loginPath: '/login',
      portalPath: '/tpo/portal',
      emailSent: shouldEmail,
    };
  }

  await addAudit({
    actorId: req.user.id,
    action: 'TPO_CREATED',
    entityType: 'Tpo',
    entityId: tpo.id,
    after: {
      name: tpo.name,
      college: tpo.college,
      email: tpo.email,
      phone: tpo.phone,
      referralCode: tpo.referralCode,
      isActive: tpo.isActive,
      portalEnabled: tpo.portalEnabled,
      hasPortalAccount: Boolean(tpo.userId),
      commissionType: tpo.commissionType,
      commissionValue: tpo.commissionValue,
    },
    ip: req.ip,
  });

  created(res, dto, 'TPO added and reference code generated successfully.');
});

/**
 * GET /api/v1/admin/tpos/:id
 * Fetches a single TPO with live referral counts and earnings metrics.
 */
const getAdminTpoById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tpo = await prisma.tpo.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!tpo) {
    throw ApiError.notFound('TPO not found.');
  }

  const metricsMap = await getTpoMetricsByIds(prisma, [tpo.id]);
  ok(res, tpoDto(tpo, metricsMap.get(tpo.id)));
});

/**
 * PATCH /api/v1/admin/tpos/:id
 * Updates TPO details, commission configuration, code active status, or private portal access.
 */
const updateAdminTpo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.tpo.findUnique({ where: { id } });

  if (!existing) {
    throw ApiError.notFound('TPO not found.');
  }

  const nextCommissionType = req.body.commissionType ?? existing.commissionType;
  const nextCommissionValue =
    req.body.commissionValue !== undefined
      ? Math.max(0, Math.round(Number(req.body.commissionValue) || 0))
      : existing.commissionValue;

  if (
    nextCommissionType === TPO_COMMISSION_TYPE.PERCENTAGE &&
    nextCommissionValue > 10000
  ) {
    throw ApiError.validationError([
      { field: 'commissionValue', message: 'Commission percentage cannot exceed 100%.' },
    ]);
  }

  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name.trim();
  if (req.body.college !== undefined) data.college = req.body.college.trim();
  if (req.body.email !== undefined) data.email = req.body.email.toLowerCase().trim();
  if (req.body.phone !== undefined) data.phone = req.body.phone.trim();
  if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
  if (req.body.portalEnabled !== undefined) data.portalEnabled = Boolean(req.body.portalEnabled);
  if (req.body.commissionType !== undefined) data.commissionType = req.body.commissionType;
  if (req.body.commissionValue !== undefined) data.commissionValue = nextCommissionValue;

  // Keep linked TPO user account email & status in sync if updated
  const updated = await prisma.$transaction(async (tx) => {
    if (existing.userId) {
      const userUpdates = {};
      if (data.name !== undefined) userUpdates.name = data.name;
      if (data.phone !== undefined) userUpdates.phone = data.phone;
      if (data.college !== undefined) userUpdates.college = data.college;
      if (data.email !== undefined && data.email !== existing.email) {
        const collision = await tx.user.findUnique({
          where: { email: data.email },
          select: { id: true },
        });
        if (collision && collision.id !== existing.userId) {
          throw ApiError.conflict(
            'DUPLICATE_EMAIL',
            'Another account already uses this email address.',
            [{ field: 'email', message: 'This email is already in use.' }],
          );
        }
        userUpdates.email = data.email;
      }
      if (Object.keys(userUpdates).length > 0) {
        await tx.user.update({
          where: { id: existing.userId },
          data: userUpdates,
        });
      }

      // Immediately revoke active refresh tokens if Admin disables portal access
      if (data.portalEnabled === false) {
        await tx.token.updateMany({
          where: { userId: existing.userId, type: 'REFRESH', revoked: false },
          data: { revoked: true },
        });
      }
    }

    return tx.tpo.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  });

  if (existing.userId) {
    invalidateAuthUserCache(existing.userId);
  }

  const isStatusOnly =
    Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, 'isActive');

  await addAudit({
    actorId: req.user.id,
    action: isStatusOnly ? 'TPO_STATUS_UPDATED' : 'TPO_UPDATED',
    entityType: 'Tpo',
    entityId: updated.id,
    before: {
      name: existing.name,
      college: existing.college,
      email: existing.email,
      phone: existing.phone,
      isActive: existing.isActive,
      portalEnabled: existing.portalEnabled,
      commissionType: existing.commissionType,
      commissionValue: existing.commissionValue,
    },
    after: {
      name: updated.name,
      college: updated.college,
      email: updated.email,
      phone: updated.phone,
      isActive: updated.isActive,
      portalEnabled: updated.portalEnabled,
      commissionType: updated.commissionType,
      commissionValue: updated.commissionValue,
    },
    ip: req.ip,
  });

  const metricsMap = await getTpoMetricsByIds(prisma, [updated.id]);
  ok(res, tpoDto(updated, metricsMap.get(updated.id)));
});

/**
 * POST /api/v1/admin/tpos/:id/portal-access
 * Provisions a private TPO login account (for existing/legacy TPOs) OR resets their password,
 * revoking existing sessions and returning one-time credentials for Admin to share privately.
 */
const provisionOrResetTpoPortalAccess = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password, sendEmail = true } = req.body || {};

  const tpo = await prisma.tpo.findUnique({ where: { id } });
  if (!tpo) {
    throw ApiError.notFound('TPO not found.');
  }

  const rawPassword =
    password && password.trim() ? password.trim() : generateSecureTpoPassword();
  const passwordHash = await hashPassword(rawPassword);
  const tpoRole = await ensureTpoRole(prisma);

  let action = 'TPO_PORTAL_ACCESS_RESET';
  let userId = tpo.userId;

  await prisma.$transaction(async (tx) => {
    if (userId) {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          status: USER_STATUS.ACTIVE,
          emailVerified: true,
        },
      });
      // Ensure TPO role is attached
      await tx.userRole.upsert({
        where: { userId_roleId: { userId, roleId: tpoRole.id } },
        update: {},
        create: { userId, roleId: tpoRole.id },
      });
      // Revoke existing sessions so old credentials stop working immediately
      await tx.token.updateMany({
        where: { userId, type: 'REFRESH', revoked: false },
        data: { revoked: true },
      });
    } else {
      action = 'TPO_PORTAL_ACCESS_CREATED';
      const existingUser = await tx.user.findUnique({
        where: { email: tpo.email.toLowerCase() },
        select: { id: true },
      });
      if (existingUser) {
        throw ApiError.conflict(
          'DUPLICATE_EMAIL',
          'Another account already uses this TPO email. Update the TPO email first before enabling portal access.',
        );
      }

      const createdUser = await tx.user.create({
        data: {
          name: tpo.name,
          email: tpo.email.toLowerCase(),
          phone: tpo.phone,
          college: tpo.college,
          passwordHash,
          status: USER_STATUS.ACTIVE,
          emailVerified: true,
        },
      });

      await tx.userRole.create({
        data: { userId: createdUser.id, roleId: tpoRole.id },
      });

      userId = createdUser.id;
    }

    await tx.tpo.update({
      where: { id: tpo.id },
      data: {
        userId,
        portalEnabled: true,
      },
    });
  });

  if (userId) {
    invalidateAuthUserCache(userId);
  }

  const shouldEmail = sendEmail !== false;
  if (shouldEmail) {
    sendTpoWelcomeEmail({
      to: tpo.email,
      name: tpo.name,
      college: tpo.college,
      referralCode: tpo.referralCode,
      email: tpo.email,
      password: rawPassword,
    }).catch((err) => {
      logger.warn(`[Admin] Failed to email reset credentials to TPO ${tpo.email}: ${err.message}`);
    });
  }

  await addAudit({
    actorId: req.user.id,
    action,
    entityType: 'Tpo',
    entityId: tpo.id,
    after: { userId, portalEnabled: true, emailSent: shouldEmail },
    ip: req.ip,
  });

  ok(
    res,
    {
      tpoId: tpo.id,
      userId,
      portalEnabled: true,
      credentials: {
        email: tpo.email,
        password: rawPassword,
        loginPath: '/login',
        portalPath: '/tpo/portal',
        emailSent: shouldEmail,
      },
    },
    action === 'TPO_PORTAL_ACCESS_CREATED'
      ? 'Private TPO portal account created successfully.'
      : 'TPO portal password reset successfully.',
  );
});

/**
 * DELETE /api/v1/admin/tpos/:id
 * Deletes a TPO record only if no financial ledger entries exist; otherwise instructs Admin to deactivate.
 */
const deleteAdminTpo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.tpo.findUnique({
    where: { id },
    include: {
      _count: {
        select: { earnings: true, payouts: true },
      },
    },
  });

  if (!existing) {
    throw ApiError.notFound('TPO not found.');
  }

  if (existing._count.earnings > 0 || existing._count.payouts > 0) {
    throw ApiError.conflict(
      'TPO_HAS_FINANCIAL_HISTORY',
      'This TPO has recorded referral earnings or payouts and cannot be deleted. Deactivate their code and disable portal access instead to preserve financial audit history.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.tpo.delete({ where: { id } });

    if (existing.userId) {
      const roles = await tx.userRole.findMany({
        where: { userId: existing.userId },
        include: { role: true },
      });
      const roleNames = roles.map((r) => r.role?.name).filter(Boolean);
      const isTpoOnlyAccount = roleNames.length === 1 && roleNames[0] === ROLES.TPO;
      if (isTpoOnlyAccount) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { status: USER_STATUS.SUSPENDED },
        });
        await tx.token.updateMany({
          where: { userId: existing.userId, type: 'REFRESH', revoked: false },
          data: { revoked: true },
        });
      }
    }
  });

  if (existing.userId) {
    invalidateAuthUserCache(existing.userId);
  }

  await addAudit({
    actorId: req.user.id,
    action: 'TPO_DELETED',
    entityType: 'Tpo',
    entityId: existing.id,
    before: {
      name: existing.name,
      college: existing.college,
      email: existing.email,
      phone: existing.phone,
      referralCode: existing.referralCode,
      isActive: existing.isActive,
      portalEnabled: existing.portalEnabled,
    },
    ip: req.ip,
  });

  ok(res, { deleted: true, _id: existing.id }, 'TPO deleted successfully.');
});

/**
 * GET /api/v1/admin/tpos/:id/referrals
 * Lists students referred by a specific TPO (with full student details & earnings for Admin).
 */
const listTpoReferrals = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, verified = 'true' } = req.query;

  const tpo = await prisma.tpo.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!tpo) {
    throw ApiError.notFound('TPO not found.');
  }

  const where = {
    OR: [
      { referredByTpoId: tpo.id },
      { tpoEarnings: { some: { tpoId: tpo.id } } },
    ],
    ...(verified === 'true' && { emailVerified: true }),
    ...(verified === 'false' && { emailVerified: false }),
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

  const [total, students, metricsMap] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        emailVerified: true,
        authProvider: true,
        college: true,
        referralCodeUsed: true,
        createdAt: true,
        enrollments: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            plan: {
              select: {
                domain: { select: { name: true } },
                designation: { select: { name: true } },
                durationMonths: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        tpoEarnings: {
          where: { tpoId: tpo.id },
          select: {
            id: true,
            paymentAmountPaise: true,
            earnedAmountPaise: true,
            status: true,
            currency: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    getTpoMetricsByIds(prisma, [tpo.id]),
  ]);

  const rows = students.map((student) => {
    const latestEnrollment = student.enrollments?.[0] || null;
    const earnings = student.tpoEarnings || [];
    const activeEarnings = earnings.filter((e) => e.status !== TPO_EARNING_STATUS.REVERSED);
    const earnedAmountPaise = activeEarnings.reduce(
      (sum, e) => sum + Number(e.earnedAmountPaise || 0),
      0,
    );
    const studentPaidPaise = activeEarnings.reduce(
      (sum, e) => sum + Number(e.paymentAmountPaise || 0),
      0,
    );
    const latestEarning = earnings[0] || null;

    let earningStatus = 'UNPAID';
    if (activeEarnings.length > 0) {
      earningStatus = activeEarnings.every((e) => e.status === TPO_EARNING_STATUS.PAID)
        ? TPO_EARNING_STATUS.PAID
        : TPO_EARNING_STATUS.CONFIRMED;
    } else if (latestEarning?.status === TPO_EARNING_STATUS.REVERSED) {
      earningStatus = TPO_EARNING_STATUS.REVERSED;
    }

    return {
      _id: student.id,
      id: student.id,
      name: student.name,
      email: student.email,
      status: student.status,
      emailVerified: Boolean(student.emailVerified),
      authProvider: student.authProvider,
      college: student.college || null,
      referralCodeUsed: student.referralCodeUsed || tpo.referralCode,
      latestEnrollment: latestEnrollment
        ? {
            _id: latestEnrollment.id,
            status: latestEnrollment.status,
            paymentStatus: latestEnrollment.paymentStatus,
            domain: latestEnrollment.plan?.domain?.name || null,
            designation: latestEnrollment.plan?.designation?.name || null,
            durationMonths: latestEnrollment.plan?.durationMonths || null,
          }
        : null,
      studentPaidPaise,
      earnedAmountPaise,
      earningStatus,
      createdAt: student.createdAt,
    };
  });

  const response = paginatedResponse(rows, total, page, limit);
  response.tpo = tpoDto(tpo, metricsMap.get(tpo.id));

  ok(res, response);
});

/**
 * GET /api/v1/admin/tpos/:id/earnings
 * Returns full earnings ledger and payout history for a specific TPO (Admin only).
 */
const getAdminTpoEarnings = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { status } = req.query;

  const tpo = await prisma.tpo.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!tpo) {
    throw ApiError.notFound('TPO not found.');
  }

  const earningWhere = {
    tpoId: tpo.id,
    ...(status &&
      Object.values(TPO_EARNING_STATUS).includes(String(status).toUpperCase()) && {
        status: String(status).toUpperCase(),
      }),
  };

  const [total, earnings, payouts, metricsMap] = await Promise.all([
    prisma.tpoEarning.count({ where: earningWhere }),
    prisma.tpoEarning.findMany({
      where: earningWhere,
      include: {
        student: { select: { id: true, name: true, email: true, college: true } },
        enrollment: {
          select: {
            id: true,
            status: true,
            plan: {
              select: {
                domain: { select: { name: true } },
                designation: { select: { name: true } },
                durationMonths: true,
              },
            },
          },
        },
        payout: {
          select: { id: true, paidAt: true, paymentMethod: true, transactionRef: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.tpoPayout.findMany({
      where: { tpoId: tpo.id },
      include: {
        recordedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { earnings: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 25,
    }),
    getTpoMetricsByIds(prisma, [tpo.id]),
  ]);

  const earningRows = earnings.map((e) => ({
    _id: e.id,
    id: e.id,
    student: e.student
      ? {
          _id: e.student.id,
          name: e.student.name,
          email: e.student.email,
          college: e.student.college || null,
        }
      : null,
    domain: e.enrollment?.plan?.domain?.name || null,
    designation: e.enrollment?.plan?.designation?.name || null,
    durationMonths: e.enrollment?.plan?.durationMonths || null,
    referralCodeUsed: e.referralCodeUsed,
    paymentAmountPaise: e.paymentAmountPaise,
    commissionType: e.commissionType,
    commissionValue: e.commissionValue,
    earnedAmountPaise: e.earnedAmountPaise,
    currency: e.currency,
    status: e.status,
    payout: e.payout || null,
    createdAt: e.createdAt,
  }));

  const payoutRows = payouts.map((p) => ({
    _id: p.id,
    id: p.id,
    amountPaise: p.amountPaise,
    currency: p.currency,
    status: p.status,
    paymentMethod: p.paymentMethod || null,
    transactionRef: p.transactionRef || null,
    notes: p.notes || null,
    earningsCount: p._count?.earnings || 0,
    recordedBy: p.recordedBy || null,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  }));

  const response = paginatedResponse(earningRows, total, page, limit);
  response.tpo = tpoDto(tpo, metricsMap.get(tpo.id));
  response.payouts = payoutRows;

  ok(res, response);
});

/**
 * POST /api/v1/admin/tpos/:id/payouts
 * Atomically settles eligible CONFIRMED earnings for a TPO into a recorded TpoPayout.
 */
const recordAdminTpoPayout = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    earningIds,
    paymentMethod = 'Bank Transfer / UPI',
    transactionRef,
    notes,
    paidAt,
  } = req.body || {};

  const tpo = await prisma.tpo.findUnique({ where: { id } });
  if (!tpo) {
    throw ApiError.notFound('TPO not found.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const eligibleWhere = {
      tpoId: tpo.id,
      status: TPO_EARNING_STATUS.CONFIRMED,
      payoutId: null,
      ...(Array.isArray(earningIds) && earningIds.length > 0
        ? { id: { in: earningIds } }
        : {}),
    };

    const eligibleEarnings = await tx.tpoEarning.findMany({
      where: eligibleWhere,
      select: { id: true, earnedAmountPaise: true, currency: true },
    });

    if (eligibleEarnings.length === 0) {
      throw ApiError.unprocessable(
        'NO_PENDING_EARNINGS',
        'There are no confirmed unpaid earnings available to settle for this TPO.',
      );
    }

    const totalAmountPaise = eligibleEarnings.reduce(
      (sum, row) => sum + Number(row.earnedAmountPaise || 0),
      0,
    );

    if (totalAmountPaise <= 0) {
      throw ApiError.unprocessable(
        'ZERO_PAYOUT_AMOUNT',
        'Pending earnings amount is ₹0. Nothing to pay out.',
      );
    }

    const payout = await tx.tpoPayout.create({
      data: {
        tpoId: tpo.id,
        amountPaise: totalAmountPaise,
        currency: eligibleEarnings[0].currency || 'INR',
        status: TPO_PAYOUT_STATUS.PAID,
        paymentMethod: paymentMethod ? String(paymentMethod).trim() : null,
        transactionRef: transactionRef ? String(transactionRef).trim() : null,
        notes: notes ? String(notes).trim() : null,
        recordedById: req.user.id,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
      },
    });

    await tx.tpoEarning.updateMany({
      where: { id: { in: eligibleEarnings.map((e) => e.id) } },
      data: {
        status: TPO_EARNING_STATUS.PAID,
        payoutId: payout.id,
      },
    });

    return { payout, settledCount: eligibleEarnings.length };
  });

  await addAudit({
    actorId: req.user.id,
    action: 'TPO_PAYOUT_RECORDED',
    entityType: 'TpoPayout',
    entityId: result.payout.id,
    after: {
      tpoId: tpo.id,
      tpoName: tpo.name,
      amountPaise: result.payout.amountPaise,
      settledEarningsCount: result.settledCount,
      paymentMethod: result.payout.paymentMethod,
      transactionRef: result.payout.transactionRef,
    },
    ip: req.ip,
  });

  created(
    res,
    {
      _id: result.payout.id,
      id: result.payout.id,
      tpoId: tpo.id,
      amountPaise: result.payout.amountPaise,
      currency: result.payout.currency,
      status: result.payout.status,
      paymentMethod: result.payout.paymentMethod,
      transactionRef: result.payout.transactionRef,
      notes: result.payout.notes,
      earningsCount: result.settledCount,
      paidAt: result.payout.paidAt,
    },
    'Payout recorded and pending earnings marked as paid.',
  );
});

module.exports = {
  tpoDto,
  listAdminTpos,
  createAdminTpo,
  getAdminTpoById,
  updateAdminTpo,
  provisionOrResetTpoPortalAccess,
  deleteAdminTpo,
  listTpoReferrals,
  getAdminTpoEarnings,
  recordAdminTpoPayout,
};
