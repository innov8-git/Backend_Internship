'use strict';

const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const { ROLES, TPO_EARNING_STATUS } = require('../../common/constants');
const {
  maskStudentEmail,
  getTpoMetricsByIds,
} = require('./services/tpo-earnings.service');

/**
 * Resolves the authorized TPO profile for the current request.
 * - TPO role: ALWAYS scoped strictly to their own linked Tpo (userId === req.user.id).
 *             Client-supplied tpoId is ignored to prevent IDOR.
 *             Blocked immediately if portalEnabled is false.
 * - ADMIN role: May pass ?tpoId=<uuid> to preview any TPO's private view, or falls back to
 *               their own linked Tpo if present.
 */
async function resolveScopedTpo(req) {
  const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdmin = userRoles.includes(ROLES.ADMIN);
  const requestedTpoId = isAdmin && req.query?.tpoId ? String(req.query.tpoId).trim() : null;

  let tpo = null;
  if (requestedTpoId) {
    tpo = await prisma.tpo.findUnique({ where: { id: requestedTpoId } });
    if (!tpo) {
      throw ApiError.notFound('TPO profile not found.');
    }
    return tpo;
  }

  tpo = await prisma.tpo.findUnique({
    where: { userId: req.user.id },
  });

  if (!tpo) {
    throw ApiError.forbidden(
      'TPO_ACCESS_NOT_LINKED',
      'No TPO partner profile is linked to this account.',
    );
  }

  if (!isAdmin && !tpo.portalEnabled) {
    throw ApiError.forbidden(
      'TPO_PORTAL_DISABLED',
      'Your TPO referral portal access is currently disabled. Contact the administrator.',
    );
  }

  return tpo;
}

/**
 * GET /api/v1/tpo/me/summary
 * Returns the authenticated TPO's referral counts, paid conversions, and earnings breakdown.
 */
const getMyTpoSummary = asyncHandler(async (req, res) => {
  const tpo = await resolveScopedTpo(req);
  const metricsMap = await getTpoMetricsByIds(prisma, [tpo.id]);
  const metrics = metricsMap.get(tpo.id) || {
    verified: 0,
    pending: 0,
    paidConversions: 0,
    totalEarnedPaise: 0,
    paidOutPaise: 0,
    pendingPayoutPaise: 0,
    reversedAmountPaise: 0,
    totalStudentRevenuePaise: 0,
  };

  ok(res, {
    tpo: {
      _id: tpo.id,
      id: tpo.id,
      name: tpo.name,
      college: tpo.college,
      email: tpo.email,
      phone: tpo.phone,
      referralCode: tpo.referralCode,
      isActive: Boolean(tpo.isActive),
      portalEnabled: Boolean(tpo.portalEnabled),
      commissionType: tpo.commissionType,
      commissionValue: tpo.commissionValue,
      createdAt: tpo.createdAt,
    },
    stats: {
      totalReferredStudents: metrics.verified,
      pendingVerificationStudents: metrics.pending,
      paidConversions: metrics.paidConversions,
      totalEarnedPaise: metrics.totalEarnedPaise,
      paidOutPaise: metrics.paidOutPaise,
      pendingPayoutPaise: metrics.pendingPayoutPaise,
      reversedAmountPaise: metrics.reversedAmountPaise,
      currency: 'INR',
    },
  });
});

/**
 * GET /api/v1/tpo/me/referrals
 * Returns paginated list of students referred by the authenticated TPO with masked emails
 * and per-student earning details (4A privacy rule).
 */
const listMyTpoReferrals = asyncHandler(async (req, res) => {
  const tpo = await resolveScopedTpo(req);
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { search, filter = 'all' } = req.query;

  const baseOr = [
    { referredByTpoId: tpo.id },
    { tpoEarnings: { some: { tpoId: tpo.id } } },
  ];

  const where = {
    AND: [
      { OR: baseOr },
      ...(filter === 'paid'
        ? [
            {
              tpoEarnings: {
                some: {
                  tpoId: tpo.id,
                  status: { in: [TPO_EARNING_STATUS.CONFIRMED, TPO_EARNING_STATUS.PAID] },
                },
              },
            },
          ]
        : []),
      ...(filter === 'unpaid'
        ? [
            {
              tpoEarnings: {
                none: {
                  tpoId: tpo.id,
                  status: { in: [TPO_EARNING_STATUS.CONFIRMED, TPO_EARNING_STATUS.PAID] },
                },
              },
            },
          ]
        : []),
      ...(search
        ? [
            {
              OR: [
                { name: { contains: String(search), mode: 'insensitive' } },
                { college: { contains: String(search), mode: 'insensitive' } },
              ],
            },
          ]
        : []),
    ],
  };

  const [total, students] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        college: true,
        emailVerified: true,
        createdAt: true,
        enrollments: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            createdAt: true,
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
            commissionType: true,
            commissionValue: true,
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
  ]);

  const rows = students.map((student) => {
    const latestEnrollment = student.enrollments?.[0] || null;
    const earnings = student.tpoEarnings || [];
    const activeEarnings = earnings.filter((e) => e.status !== TPO_EARNING_STATUS.REVERSED);
    const totalEarnedForStudent = activeEarnings.reduce(
      (sum, e) => sum + Number(e.earnedAmountPaise || 0),
      0,
    );
    const totalPaidByStudent = activeEarnings.reduce(
      (sum, e) => sum + Number(e.paymentAmountPaise || 0),
      0,
    );
    const latestEarning = earnings[0] || null;

    let earningStatus = 'UNPAID';
    if (activeEarnings.length > 0) {
      const allPaid = activeEarnings.every((e) => e.status === TPO_EARNING_STATUS.PAID);
      earningStatus = allPaid ? TPO_EARNING_STATUS.PAID : TPO_EARNING_STATUS.CONFIRMED;
    } else if (latestEarning?.status === TPO_EARNING_STATUS.REVERSED) {
      earningStatus = TPO_EARNING_STATUS.REVERSED;
    }

    return {
      _id: student.id,
      id: student.id,
      name: student.name,
      maskedEmail: maskStudentEmail(student.email),
      college: student.college || null,
      emailVerified: Boolean(student.emailVerified),
      joinedAt: student.createdAt,
      enrollment: latestEnrollment
        ? {
            status: latestEnrollment.status,
            paymentStatus: latestEnrollment.paymentStatus,
            domain: latestEnrollment.plan?.domain?.name || null,
            designation: latestEnrollment.plan?.designation?.name || null,
            durationMonths: latestEnrollment.plan?.durationMonths || null,
          }
        : null,
      paidEnrollmentsCount: activeEarnings.length,
      studentPaidPaise: totalPaidByStudent,
      earnedAmountPaise: totalEarnedForStudent,
      earningStatus,
      currency: latestEarning?.currency || 'INR',
      creditedAt: latestEarning?.createdAt || null,
    };
  });

  ok(res, paginatedResponse(rows, total, page, limit));
});

/**
 * GET /api/v1/tpo/me/payouts
 * Returns paginated payout settlement history for the authenticated TPO.
 */
const listMyTpoPayouts = asyncHandler(async (req, res) => {
  const tpo = await resolveScopedTpo(req);
  const { page, limit, skip } = parsePagination(req.query, 10);

  const where = { tpoId: tpo.id };

  const [total, payouts] = await Promise.all([
    prisma.tpoPayout.count({ where }),
    prisma.tpoPayout.findMany({
      where,
      include: {
        _count: { select: { earnings: true } },
      },
      orderBy: { paidAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const rows = payouts.map((p) => ({
    _id: p.id,
    id: p.id,
    amountPaise: p.amountPaise,
    currency: p.currency,
    status: p.status,
    paymentMethod: p.paymentMethod || null,
    transactionRef: p.transactionRef || null,
    notes: p.notes || null,
    earningsCount: p._count?.earnings || 0,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  }));

  ok(res, paginatedResponse(rows, total, page, limit));
});

module.exports = {
  getMyTpoSummary,
  listMyTpoReferrals,
  listMyTpoPayouts,
};
