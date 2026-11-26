'use strict';

const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const { addAudit } = require('../audit-log/audit-log.service');
const { generateUniqueTpoReferralCode } = require('./services/tpo-code.util');

function tpoDto(tpo, counts = {}) {
  if (!tpo) return null;
  const verifiedCount = Number(counts.verified ?? tpo.totalReferences ?? 0);
  const pendingCount = Number(counts.pending ?? tpo.pendingReferences ?? 0);
  return {
    _id: tpo.id,
    id: tpo.id,
    name: tpo.name,
    college: tpo.college,
    email: tpo.email,
    phone: tpo.phone,
    referralCode: tpo.referralCode,
    isActive: Boolean(tpo.isActive),
    totalReferences: verifiedCount,
    pendingReferences: pendingCount,
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
 * Computes verified and unverified student referral counts keyed by tpoId.
 */
async function getReferralCountsByTpoIds(tpoIds) {
  const map = new Map();
  if (!Array.isArray(tpoIds) || tpoIds.length === 0) return map;

  const grouped = await prisma.user.groupBy({
    by: ['referredByTpoId', 'emailVerified'],
    where: {
      referredByTpoId: { in: tpoIds },
    },
    _count: { _all: true },
  });

  for (const row of grouped) {
    const tpoId = row.referredByTpoId;
    if (!tpoId) continue;
    const entry = map.get(tpoId) || { verified: 0, pending: 0 };
    if (row.emailVerified) {
      entry.verified += row._count._all;
    } else {
      entry.pending += row._count._all;
    }
    map.set(tpoId, entry);
  }

  return map;
}

/**
 * GET /api/v1/admin/tpos
 * Lists TPOs with pagination, search, status filter, sorting, and live email-verified referral counts.
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
    if (['name', 'college', 'createdAt', 'totalReferences'].includes(field)) {
      sortField = field;
    }
    if (dir === 'asc' || dir === 'desc') {
      sortDir = dir;
    }
  }

  const [total, totalTpos, activeTpos, totalVerifiedReferrals] = await Promise.all([
    prisma.tpo.count({ where }),
    prisma.tpo.count(),
    prisma.tpo.count({ where: { isActive: true } }),
    prisma.user.count({
      where: {
        referredByTpoId: { not: null },
        emailVerified: true,
      },
    }),
  ]);

  let items;
  if (sortField === 'totalReferences') {
    const allMatched = await prisma.tpo.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const countsMap = await getReferralCountsByTpoIds(allMatched.map((t) => t.id));
    const enriched = allMatched.map((t) => tpoDto(t, countsMap.get(t.id)));
    const factor = sortDir === 'asc' ? 1 : -1;
    enriched.sort(
      (a, b) =>
        (a.totalReferences - b.totalReferences) * factor ||
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
    const countsMap = await getReferralCountsByTpoIds(tpos.map((t) => t.id));
    items = tpos.map((t) => tpoDto(t, countsMap.get(t.id)));
  }

  const response = paginatedResponse(items, total, page, limit);
  response.summary = {
    totalTpos,
    activeTpos,
    inactiveTpos: totalTpos - activeTpos,
    totalReferences: totalVerifiedReferrals,
  };

  ok(res, response);
});

/**
 * POST /api/v1/admin/tpos
 * Creates a new TPO record and generates a unique referral code with TPO initials.
 */
const createAdminTpo = asyncHandler(async (req, res) => {
  const { name, college, email, phone } = req.body;

  let tpo = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referralCode = await generateUniqueTpoReferralCode(prisma, name);
    try {
      tpo = await prisma.tpo.create({
        data: {
          name,
          college,
          email: email.toLowerCase(),
          phone,
          referralCode,
          isActive: true,
          createdById: req.user.id,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      break;
    } catch (err) {
      if (err?.code === 'P2002' && attempt < 2) {
        continue;
      }
      throw err;
    }
  }

  const dto = tpoDto(tpo, { verified: 0, pending: 0 });

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
    },
    ip: req.ip,
  });

  created(res, dto, 'TPO added and reference code generated successfully.');
});

/**
 * GET /api/v1/admin/tpos/:id
 * Fetches a single TPO with live verified/pending referral counts.
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

  const countsMap = await getReferralCountsByTpoIds([tpo.id]);
  ok(res, tpoDto(tpo, countsMap.get(tpo.id)));
});

/**
 * PATCH /api/v1/admin/tpos/:id
 * Updates TPO details or toggles active/inactive status.
 */
const updateAdminTpo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.tpo.findUnique({ where: { id } });

  if (!existing) {
    throw ApiError.notFound('TPO not found.');
  }

  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.college !== undefined) data.college = req.body.college;
  if (req.body.email !== undefined) data.email = req.body.email.toLowerCase();
  if (req.body.phone !== undefined) data.phone = req.body.phone;
  if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

  const updated = await prisma.tpo.update({
    where: { id },
    data,
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

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
    },
    after: {
      name: updated.name,
      college: updated.college,
      email: updated.email,
      phone: updated.phone,
      isActive: updated.isActive,
    },
    ip: req.ip,
  });

  const countsMap = await getReferralCountsByTpoIds([updated.id]);
  ok(res, tpoDto(updated, countsMap.get(updated.id)));
});

/**
 * DELETE /api/v1/admin/tpos/:id
 * Deletes a TPO record (existing student accounts remain intact via onDelete: SetNull).
 */
const deleteAdminTpo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.tpo.findUnique({ where: { id } });

  if (!existing) {
    throw ApiError.notFound('TPO not found.');
  }

  await prisma.tpo.delete({ where: { id } });

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
    },
    ip: req.ip,
  });

  ok(res, { deleted: true, _id: existing.id }, 'TPO deleted successfully.');
});

/**
 * GET /api/v1/admin/tpos/:id/referrals
 * Lists students referred by a specific TPO (defaults to email-verified students).
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
    referredByTpoId: tpo.id,
    ...(verified === 'true' && { emailVerified: true }),
    ...(verified === 'false' && { emailVerified: false }),
    ...(search && {
      OR: [
        { name: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ],
    }),
  };

  const [total, students, countsMap] = await Promise.all([
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
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    getReferralCountsByTpoIds([tpo.id]),
  ]);

  const rows = students.map((student) => {
    const latestEnrollment = student.enrollments?.[0] || null;
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
            domain: latestEnrollment.plan?.domain?.name || null,
            designation: latestEnrollment.plan?.designation?.name || null,
            durationMonths: latestEnrollment.plan?.durationMonths || null,
          }
        : null,
      createdAt: student.createdAt,
    };
  });

  const response = paginatedResponse(rows, total, page, limit);
  response.tpo = tpoDto(tpo, countsMap.get(tpo.id));

  ok(res, response);
});

module.exports = {
  tpoDto,
  listAdminTpos,
  createAdminTpo,
  getAdminTpoById,
  updateAdminTpo,
  deleteAdminTpo,
  listTpoReferrals,
};
