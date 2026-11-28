'use strict';

const {
  ROLES,
  TPO_COMMISSION_TYPE,
  TPO_EARNING_STATUS,
  TPO_PAYOUT_STATUS,
} = require('../../../common/constants');

/**
 * Masks a student email address for TPO privacy (e.g. "alex.morgan@pit.edu" -> "al***@pit.edu").
 */
function maskStudentEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const [localPart, domain] = email.split('@');
  if (!domain) return '***';
  const visibleCount = localPart.length <= 2 ? 1 : 2;
  const visible = localPart.slice(0, visibleCount);
  return `${visible}***@${domain}`;
}

/**
 * Calculates TPO commission in integer paise.
 * - FIXED: commissionValue is already integer paise (e.g. 20000 = ₹200).
 * - PERCENTAGE: commissionValue is basis points (e.g. 1000 = 10.00%, 1250 = 12.50%).
 * Commission is capped at paymentAmountPaise so it can never exceed what the student paid.
 */
function calculateCommissionPaise(paymentAmountPaise, commissionType, commissionValue) {
  const paid = Math.max(0, Math.round(Number(paymentAmountPaise) || 0));
  const rate = Math.max(0, Math.round(Number(commissionValue) || 0));
  if (paid === 0 || rate === 0) return 0;

  if (commissionType === TPO_COMMISSION_TYPE.PERCENTAGE) {
    const clampedBps = Math.min(rate, 10000);
    return Math.min(paid, Math.round((paid * clampedBps) / 10000));
  }

  return Math.min(paid, rate);
}

/**
 * Ensures the TPO system role exists in the database (resilient even if seed-rbac wasn't re-run).
 */
async function ensureTpoRole(db) {
  let role = await db.roleModel.findUnique({ where: { name: ROLES.TPO } });
  if (!role) {
    role = await db.roleModel.create({
      data: {
        name: ROLES.TPO,
        displayName: 'TPO',
        description: 'Training & Placement Officer with private referral portal access',
        isSystem: true,
      },
    });
  }
  return role;
}

/**
 * Idempotently records a TPO earning snapshot when an enrollment payment succeeds.
 * Safe to call inside or outside a Prisma transaction.
 */
async function recordTpoEarningForPayment(
  db,
  {
    enrollmentId,
    paymentId,
    studentId,
    paymentAmountPaise,
    currency = 'INR',
    explicitTpoId = null,
    explicitReferralCode = null,
  },
) {
  if (!enrollmentId || !paymentId || !studentId) return null;

  const existing = await db.tpoEarning.findFirst({
    where: {
      OR: [{ paymentId }, { enrollmentId }],
    },
  });
  if (existing) return existing;

  let tpoId = explicitTpoId || null;
  let referralCodeUsed = explicitReferralCode || null;

  if (!tpoId) {
    const [enrollment, student] = await Promise.all([
      db.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { priceSnapshot: true },
      }),
      db.user.findUnique({
        where: { id: studentId },
        select: { referredByTpoId: true, referralCodeUsed: true },
      }),
    ]);

    const snapshot = enrollment?.priceSnapshot || {};
    if (snapshot && typeof snapshot === 'object' && snapshot.tpoId) {
      tpoId = snapshot.tpoId;
      referralCodeUsed = referralCodeUsed || snapshot.referralCode || null;
    } else if (student?.referredByTpoId) {
      tpoId = student.referredByTpoId;
      referralCodeUsed = referralCodeUsed || student.referralCodeUsed || null;
    }
  }

  if (!tpoId) return null;

  const tpo = await db.tpo.findUnique({
    where: { id: tpoId },
    select: {
      id: true,
      referralCode: true,
      commissionType: true,
      commissionValue: true,
    },
  });
  if (!tpo) return null;

  const paidPaise = Math.max(0, Math.round(Number(paymentAmountPaise) || 0));
  const earnedAmountPaise = calculateCommissionPaise(
    paidPaise,
    tpo.commissionType,
    tpo.commissionValue,
  );

  try {
    return await db.tpoEarning.create({
      data: {
        tpoId: tpo.id,
        studentId,
        enrollmentId,
        paymentId,
        referralCodeUsed: referralCodeUsed || tpo.referralCode,
        paymentAmountPaise: paidPaise,
        commissionType: tpo.commissionType,
        commissionValue: tpo.commissionValue,
        earnedAmountPaise,
        currency: currency || 'INR',
        status: TPO_EARNING_STATUS.CONFIRMED,
      },
    });
  } catch (err) {
    // Handle concurrent webhook/payment completion idempotently
    if (err?.code === 'P2002') {
      return db.tpoEarning.findFirst({
        where: { OR: [{ paymentId }, { enrollmentId }] },
      });
    }
    throw err;
  }
}

/**
 * Reverses a confirmed (unpaid) TPO earning when its underlying payment is refunded.
 */
async function reverseTpoEarningForRefund(db, paymentId) {
  if (!paymentId) return null;
  const earning = await db.tpoEarning.findUnique({
    where: { paymentId },
  });
  if (!earning || earning.status === TPO_EARNING_STATUS.REVERSED) {
    return earning;
  }
  return db.tpoEarning.update({
    where: { id: earning.id },
    data: { status: TPO_EARNING_STATUS.REVERSED },
  });
}

/**
 * Computes batched referral counts and earnings summaries keyed by tpoId.
 */
async function getTpoMetricsByIds(db, tpoIds) {
  const map = new Map();
  if (!Array.isArray(tpoIds) || tpoIds.length === 0) return map;

  const ensureEntry = (id) => {
    if (!map.has(id)) {
      map.set(id, {
        verified: 0,
        pending: 0,
        paidConversions: 0,
        totalEarnedPaise: 0,
        paidOutPaise: 0,
        pendingPayoutPaise: 0,
        reversedAmountPaise: 0,
        totalStudentRevenuePaise: 0,
      });
    }
    return map.get(id);
  };

  for (const id of tpoIds) {
    ensureEntry(id);
  }

  const [userGroups, earningGroups] = await Promise.all([
    db.user.groupBy({
      by: ['referredByTpoId', 'emailVerified'],
      where: {
        referredByTpoId: { in: tpoIds },
      },
      _count: { _all: true },
    }),
    db.tpoEarning.groupBy({
      by: ['tpoId', 'status'],
      where: {
        tpoId: { in: tpoIds },
      },
      _count: { _all: true },
      _sum: {
        earnedAmountPaise: true,
        paymentAmountPaise: true,
      },
    }),
  ]);

  for (const row of userGroups) {
    if (!row.referredByTpoId) continue;
    const entry = ensureEntry(row.referredByTpoId);
    if (row.emailVerified) {
      entry.verified += row._count._all;
    } else {
      entry.pending += row._count._all;
    }
  }

  for (const row of earningGroups) {
    const entry = ensureEntry(row.tpoId);
    const earned = Number(row._sum?.earnedAmountPaise || 0);
    const revenue = Number(row._sum?.paymentAmountPaise || 0);
    const count = Number(row._count?._all || 0);

    if (row.status === TPO_EARNING_STATUS.CONFIRMED) {
      entry.paidConversions += count;
      entry.totalEarnedPaise += earned;
      entry.pendingPayoutPaise += earned;
      entry.totalStudentRevenuePaise += revenue;
    } else if (row.status === TPO_EARNING_STATUS.PAID) {
      entry.paidConversions += count;
      entry.totalEarnedPaise += earned;
      entry.paidOutPaise += earned;
      entry.totalStudentRevenuePaise += revenue;
    } else if (row.status === TPO_EARNING_STATUS.REVERSED) {
      entry.reversedAmountPaise += earned;
    }
  }

  return map;
}

/**
 * Computes global KPI aggregates across all TPOs for the Admin console.
 */
async function getGlobalTpoSummary(db) {
  const [totalTpos, activeTpos, totalVerifiedReferrals, earningGroups, paidPayoutAgg] =
    await Promise.all([
      db.tpo.count(),
      db.tpo.count({ where: { isActive: true } }),
      db.user.count({
        where: {
          referredByTpoId: { not: null },
          emailVerified: true,
        },
      }),
      db.tpoEarning.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { earnedAmountPaise: true, paymentAmountPaise: true },
      }),
      db.tpoPayout.aggregate({
        where: { status: TPO_PAYOUT_STATUS.PAID },
        _sum: { amountPaise: true },
      }),
    ]);

  let totalPaidConversions = 0;
  let totalEarnedPaise = 0;
  let totalPendingPayoutPaise = 0;
  let totalPaidOutFromEarnings = 0;

  for (const row of earningGroups) {
    const earned = Number(row._sum?.earnedAmountPaise || 0);
    const count = Number(row._count?._all || 0);
    if (row.status === TPO_EARNING_STATUS.CONFIRMED) {
      totalPaidConversions += count;
      totalEarnedPaise += earned;
      totalPendingPayoutPaise += earned;
    } else if (row.status === TPO_EARNING_STATUS.PAID) {
      totalPaidConversions += count;
      totalEarnedPaise += earned;
      totalPaidOutFromEarnings += earned;
    }
  }

  return {
    totalTpos,
    activeTpos,
    inactiveTpos: totalTpos - activeTpos,
    totalReferences: totalVerifiedReferrals,
    totalPaidConversions,
    totalEarnedPaise,
    totalPendingPayoutPaise,
    totalPaidOutPaise: Math.max(
      totalPaidOutFromEarnings,
      Number(paidPayoutAgg?._sum?.amountPaise || 0),
    ),
  };
}

module.exports = {
  maskStudentEmail,
  calculateCommissionPaise,
  ensureTpoRole,
  recordTpoEarningForPayment,
  reverseTpoEarningForRefund,
  getTpoMetricsByIds,
  getGlobalTpoSummary,
};
