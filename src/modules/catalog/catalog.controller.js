const { prisma } = require('../../database');
const { ApiError, asyncHandler, ok, parsePagination, paginatedResponse } = require('../../utils');
const { PUBLISH_STATUS } = require('../../common/constants');

function catalogEntryDto(entry) {
  if (!entry) return null;
  return {
    _id: entry.id,
    name: entry.name,
    slug: entry.slug,
    description: entry.description || '',
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function planDto(plan) {
  if (!plan) return null;
  return {
    _id: plan.id,
    designationId: plan.designationId,
    domainId: plan.domainId,
    durationMonths: plan.durationMonths,
    basePrice: plan.basePrice,
    currency: plan.currency || 'INR',
    status: plan.status,
    designation: plan.designation
      ? {
          _id: plan.designation.id,
          name: plan.designation.name,
          slug: plan.designation.slug,
        }
      : null,
    domain: plan.domain
      ? {
          _id: plan.domain.id,
          name: plan.domain.name,
          slug: plan.domain.slug,
        }
      : null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

/**
 * GET /designations
 */
const listDesignations = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
  const search = req.query.search ? String(req.query.search).trim() : null;

  const where = {
    status: PUBLISH_STATUS.PUBLISHED,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const total = await prisma.designation.count({ where });
  const items = await prisma.designation.findMany({
    where,
    orderBy: { name: 'asc' },
    skip,
    take: limit,
  });

  ok(res, paginatedResponse(items.map(catalogEntryDto), total, page, limit));
});

/**
 * GET /designations/:idOrSlug
 */
const getDesignation = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;

  const item = await prisma.designation.findFirst({
    where: {
      status: PUBLISH_STATUS.PUBLISHED,
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
  });

  if (!item) {
    throw ApiError.notFound('Designation not found.');
  }

  ok(res, catalogEntryDto(item));
});

/**
 * GET /domains
 */
const listDomains = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
  const search = req.query.search ? String(req.query.search).trim() : null;

  const where = {
    status: PUBLISH_STATUS.PUBLISHED,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const total = await prisma.domain.count({ where });
  const items = await prisma.domain.findMany({
    where,
    orderBy: { name: 'asc' },
    skip,
    take: limit,
  });

  ok(res, paginatedResponse(items.map(catalogEntryDto), total, page, limit));
});

/**
 * GET /internship-plans
 */
const listPlans = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 100);
  const { designationId, domainId, durationMonths } = req.query;

  const where = {
    status: PUBLISH_STATUS.PUBLISHED,
    designation: { status: PUBLISH_STATUS.PUBLISHED },
    domain: { status: PUBLISH_STATUS.PUBLISHED },
    ...(designationId && { designationId: String(designationId) }),
    ...(domainId && { domainId: String(domainId) }),
    ...(durationMonths && { durationMonths: Number(durationMonths) }),
  };

  const total = await prisma.internshipPlan.count({ where });
  const items = await prisma.internshipPlan.findMany({
    where,
    include: {
      designation: true,
      domain: true,
    },
    orderBy: [
      { designation: { name: 'asc' } },
      { domain: { name: 'asc' } },
      { durationMonths: 'asc' },
    ],
    skip,
    take: limit,
  });

  ok(res, paginatedResponse(items.map(planDto), total, page, limit));
});

/**
 * GET /internship-plans/:id/schedule-preview
 */
const getSchedulePreview = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const plan = await prisma.internshipPlan.findFirst({
    where: {
      id,
      status: PUBLISH_STATUS.PUBLISHED,
      designation: { status: PUBLISH_STATUS.PUBLISHED },
      domain: { status: PUBLISH_STATUS.PUBLISHED },
    },
  });

  if (!plan) {
    throw ApiError.notFound('Plan not found.');
  }

  const template = await prisma.scheduleTemplate.findFirst({
    where: {
      designationId: plan.designationId,
      domainId: plan.domainId,
      durationMonths: plan.durationMonths,
      status: PUBLISH_STATUS.PUBLISHED,
    },
    orderBy: { version: 'desc' },
  });

  let rawDays = [];
  if (template?.days) {
    rawDays = Array.isArray(template.days) ? template.days : JSON.parse(template.days);
  }

  const days = rawDays
    .map((day) => ({
      dayNumber: Number(day.dayNumber),
      title: day.title || `Day ${day.dayNumber}`,
    }))
    .sort((a, b) => a.dayNumber - b.dayNumber);

  ok(res, {
    planId: plan.id,
    totalDays: days.length,
    days,
  });
});

module.exports = {
  listDesignations,
  getDesignation,
  listDomains,
  listPlans,
  getSchedulePreview,
};
