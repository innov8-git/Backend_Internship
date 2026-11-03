const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  parseSort,
  paginatedResponse,
  generateSlug,
} = require('../../utils');
const {
  PUBLISH_STATUS,
  SCHEDULE_STATUS,
  DURATION_OPTIONS,
  ASSESSMENT_QUESTION_COUNT,
  ASSESSMENT_OPTION_COUNT,
} = require('../../common/constants');
const { addAudit } = require('../audit-log/audit-log.service');

const NAME_MIN = 2;
const NAME_MAX = 60;
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 500;
const MAX_BASE_PRICE = 100000000; // 10 lakh rupees in paise
const MAX_SLABS = 16;
const QUESTION_TEXT_MAX = 1000;
const OPTION_TEXT_MAX = 300;
const ASSESSMENT_MAX_SCORE = 15;

function cleanText(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

function cleanMultiline(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function catalogItemDto(doc) {
  if (!doc) return null;
  return {
    _id: doc.id,
    name: doc.name,
    slug: doc.slug,
    description: doc.description || '',
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
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

function validateCatalogInput(body) {
  const name = cleanText(body?.name);
  const description = cleanMultiline(body?.description);
  const details = [];

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    details.push({
      field: 'name',
      message: `Enter a name between ${NAME_MIN} and ${NAME_MAX} characters.`,
    });
  }
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    details.push({
      field: 'description',
      message: `Enter a description between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`,
    });
  }
  return { name, description, details };
}

async function getUniqueSlug(model, name, excludeId = null) {
  const base = generateSlug(name) || 'item';
  let slug = base;
  let suffix = 2;
  while (true) {
    const existing = await prisma[model].findFirst({
      where: {
        slug,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
    if (!existing) break;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

// ─── Designations ────────────────────────────────────────────────────────────

const listAdminDesignations = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
  const search = req.query.search ? String(req.query.search).trim() : null;
  const status = req.query.status;

  const where = {
    ...(status && { status }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const { field, order } = parseSort(req.query.sort, 'name:asc', ['name', 'createdAt', 'status']);

  const [total, items] = await Promise.all([
    prisma.designation.count({ where }),
    prisma.designation.findMany({
      where,
      orderBy: { [field]: order },
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(items.map(catalogItemDto), total, page, limit));
});

const createDesignation = asyncHandler(async (req, res) => {
  const { name, description, details } = validateCatalogInput(req.body);
  if (details.length > 0) throw ApiError.validationError(details);

  const existing = await prisma.designation.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    throw ApiError.conflict('DUPLICATE_NAME', 'A designation with this name already exists.', [
      { field: 'name', message: `A designation called "${name}" already exists.` },
    ]);
  }

  const slug = await getUniqueSlug('designation', name);
  const doc = await prisma.designation.create({
    data: {
      name,
      slug,
      description,
      status: PUBLISH_STATUS.DRAFT,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'DESIGNATION_CREATED',
    entityType: 'Designation',
    entityId: doc.id,
    after: catalogItemDto(doc),
    ip: req.ip,
  });

  created(res, catalogItemDto(doc));
});

const updateDesignation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const current = await prisma.designation.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound('Designation not found.');

  const { name, description, details } = validateCatalogInput(req.body);
  if (details.length > 0) throw ApiError.validationError(details);

  const existing = await prisma.designation.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      id: { not: id },
    },
  });
  if (existing) {
    throw ApiError.conflict('DUPLICATE_NAME', 'A designation with this name already exists.', [
      { field: 'name', message: `A designation called "${name}" already exists.` },
    ]);
  }

  const slug = cleanText(current.name).toLowerCase() === name.toLowerCase()
    ? current.slug
    : await getUniqueSlug('designation', name, id);

  const updated = await prisma.designation.update({
    where: { id },
    data: {
      name,
      slug,
      description,
      updatedBy: req.user.id,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'DESIGNATION_UPDATED',
    entityType: 'Designation',
    entityId: updated.id,
    before: catalogItemDto(current),
    after: catalogItemDto(updated),
    ip: req.ip,
  });

  ok(res, catalogItemDto(updated));
});

const updateDesignationStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (![PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED].includes(status)) {
    throw ApiError.validationError([
      { field: 'status', message: 'Status must be DRAFT or PUBLISHED.' },
    ]);
  }

  const current = await prisma.designation.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound('Designation not found.');

  const updated = await prisma.designation.update({
    where: { id },
    data: { status, updatedBy: req.user.id },
  });

  await addAudit({
    actorId: req.user.id,
    action: `DESIGNATION_${status === PUBLISH_STATUS.PUBLISHED ? 'PUBLISHED' : 'UNPUBLISHED'}`,
    entityType: 'Designation',
    entityId: updated.id,
    before: { status: current.status },
    after: { status: updated.status },
    ip: req.ip,
  });

  ok(res, catalogItemDto(updated));
});

// ─── Domains ─────────────────────────────────────────────────────────────────

const listAdminDomains = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
  const search = req.query.search ? String(req.query.search).trim() : null;
  const status = req.query.status;

  const where = {
    ...(status && { status }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const { field, order } = parseSort(req.query.sort, 'name:asc', ['name', 'createdAt', 'status']);

  const [total, items] = await Promise.all([
    prisma.domain.count({ where }),
    prisma.domain.findMany({
      where,
      orderBy: { [field]: order },
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(items.map(catalogItemDto), total, page, limit));
});

const createDomain = asyncHandler(async (req, res) => {
  const { name, description, details } = validateCatalogInput(req.body);
  if (details.length > 0) throw ApiError.validationError(details);

  const existing = await prisma.domain.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    throw ApiError.conflict('DUPLICATE_NAME', 'A domain with this name already exists.', [
      { field: 'name', message: `A domain called "${name}" already exists.` },
    ]);
  }

  const slug = await getUniqueSlug('domain', name);
  const doc = await prisma.domain.create({
    data: {
      name,
      slug,
      description,
      status: PUBLISH_STATUS.DRAFT,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'DOMAIN_CREATED',
    entityType: 'Domain',
    entityId: doc.id,
    after: catalogItemDto(doc),
    ip: req.ip,
  });

  created(res, catalogItemDto(doc));
});

const updateDomain = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const current = await prisma.domain.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound('Domain not found.');

  const { name, description, details } = validateCatalogInput(req.body);
  if (details.length > 0) throw ApiError.validationError(details);

  const existing = await prisma.domain.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      id: { not: id },
    },
  });
  if (existing) {
    throw ApiError.conflict('DUPLICATE_NAME', 'A domain with this name already exists.', [
      { field: 'name', message: `A domain called "${name}" already exists.` },
    ]);
  }

  const slug = cleanText(current.name).toLowerCase() === name.toLowerCase()
    ? current.slug
    : await getUniqueSlug('domain', name, id);

  const updated = await prisma.domain.update({
    where: { id },
    data: {
      name,
      slug,
      description,
      updatedBy: req.user.id,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'DOMAIN_UPDATED',
    entityType: 'Domain',
    entityId: updated.id,
    before: catalogItemDto(current),
    after: catalogItemDto(updated),
    ip: req.ip,
  });

  ok(res, catalogItemDto(updated));
});

const updateDomainStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (![PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED].includes(status)) {
    throw ApiError.validationError([
      { field: 'status', message: 'Status must be DRAFT or PUBLISHED.' },
    ]);
  }

  const current = await prisma.domain.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound('Domain not found.');

  const updated = await prisma.domain.update({
    where: { id },
    data: { status, updatedBy: req.user.id },
  });

  await addAudit({
    actorId: req.user.id,
    action: `DOMAIN_${status === PUBLISH_STATUS.PUBLISHED ? 'PUBLISHED' : 'UNPUBLISHED'}`,
    entityType: 'Domain',
    entityId: updated.id,
    before: { status: current.status },
    after: { status: updated.status },
    ip: req.ip,
  });

  ok(res, catalogItemDto(updated));
});

// ─── Internship Plans ────────────────────────────────────────────────────────

const listAdminPlans = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 10);
  const { designationId, domainId, durationMonths, status, search } = req.query;

  const where = {
    ...(designationId && { designationId: String(designationId) }),
    ...(domainId && { domainId: String(domainId) }),
    ...(durationMonths && { durationMonths: Number(durationMonths) }),
    ...(status && { status }),
    ...(search && {
      OR: [
        { designation: { name: { contains: String(search), mode: 'insensitive' } } },
        { domain: { name: { contains: String(search), mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.internshipPlan.count({ where }),
    prisma.internshipPlan.findMany({
      where,
      include: { designation: true, domain: true },
      orderBy: [
        { designation: { name: 'asc' } },
        { domain: { name: 'asc' } },
        { durationMonths: 'asc' },
      ],
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(items.map(planDto), total, page, limit));
});

const createPlan = asyncHandler(async (req, res) => {
  const { designationId, domainId, durationMonths, basePrice } = req.body;
  const status = req.body.status || PUBLISH_STATUS.DRAFT;
  const details = [];

  const designation = designationId
    ? await prisma.designation.findUnique({ where: { id: designationId } })
    : null;
  if (!designation) details.push({ field: 'designationId', message: 'Choose a designation.' });

  const domain = domainId ? await prisma.domain.findUnique({ where: { id: domainId } }) : null;
  if (!domain) details.push({ field: 'domainId', message: 'Choose a domain.' });

  if (!DURATION_OPTIONS.includes(Number(durationMonths))) {
    details.push({
      field: 'durationMonths',
      message: `Choose a duration of ${DURATION_OPTIONS.join(', ')} months.`,
    });
  }

  if (
    typeof basePrice !== 'number' ||
    !Number.isInteger(basePrice) ||
    basePrice <= 0 ||
    basePrice > MAX_BASE_PRICE
  ) {
    details.push({
      field: 'basePrice',
      message: 'Enter a valid base price (greater than ₹0 and up to ₹10,00,000).',
    });
  }

  if (![PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED].includes(status)) {
    details.push({ field: 'status', message: 'Status must be DRAFT or PUBLISHED.' });
  }

  if (details.length > 0) throw ApiError.validationError(details);

  const duplicate = await prisma.internshipPlan.findUnique({
    where: {
      designationId_domainId_durationMonths: {
        designationId,
        domainId,
        durationMonths: Number(durationMonths),
      },
    },
  });
  if (duplicate) {
    throw ApiError.conflict('DUPLICATE_PLAN', 'A plan for this designation, domain and duration already exists.');
  }

  const plan = await prisma.internshipPlan.create({
    data: {
      designationId,
      domainId,
      durationMonths: Number(durationMonths),
      basePrice: Number(basePrice),
      currency: 'INR',
      status,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    },
    include: { designation: true, domain: true },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'PLAN_CREATED',
    entityType: 'InternshipPlan',
    entityId: plan.id,
    after: {
      basePrice: plan.basePrice,
      durationMonths: plan.durationMonths,
      designationId: plan.designationId,
      domainId: plan.domainId,
      status: plan.status,
    },
    ip: req.ip,
  });

  created(res, planDto(plan));
});

const updatePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const current = await prisma.internshipPlan.findUnique({
    where: { id },
    include: { designation: true, domain: true },
  });
  if (!current) throw ApiError.notFound('Plan not found.');

  const { designationId, domainId, durationMonths, basePrice } = req.body;
  const details = [];

  const designation = designationId
    ? await prisma.designation.findUnique({ where: { id: designationId } })
    : null;
  if (!designation) details.push({ field: 'designationId', message: 'Choose a designation.' });

  const domain = domainId ? await prisma.domain.findUnique({ where: { id: domainId } }) : null;
  if (!domain) details.push({ field: 'domainId', message: 'Choose a domain.' });

  if (!DURATION_OPTIONS.includes(Number(durationMonths))) {
    details.push({
      field: 'durationMonths',
      message: `Choose a duration of ${DURATION_OPTIONS.join(', ')} months.`,
    });
  }

  if (
    typeof basePrice !== 'number' ||
    !Number.isInteger(basePrice) ||
    basePrice <= 0 ||
    basePrice > MAX_BASE_PRICE
  ) {
    details.push({
      field: 'basePrice',
      message: 'Enter a valid base price (greater than ₹0 and up to ₹10,00,000).',
    });
  }

  if (details.length > 0) throw ApiError.validationError(details);

  const duplicate = await prisma.internshipPlan.findFirst({
    where: {
      id: { not: id },
      designationId,
      domainId,
      durationMonths: Number(durationMonths),
    },
  });
  if (duplicate) {
    throw ApiError.conflict('DUPLICATE_PLAN', 'A plan for this designation, domain and duration already exists.');
  }

  const updated = await prisma.internshipPlan.update({
    where: { id },
    data: {
      designationId,
      domainId,
      durationMonths: Number(durationMonths),
      basePrice: Number(basePrice),
      updatedBy: req.user.id,
    },
    include: { designation: true, domain: true },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'PLAN_UPDATED',
    entityType: 'InternshipPlan',
    entityId: updated.id,
    before: {
      basePrice: current.basePrice,
      durationMonths: current.durationMonths,
      designationId: current.designationId,
      domainId: current.domainId,
    },
    after: {
      basePrice: updated.basePrice,
      durationMonths: updated.durationMonths,
      designationId: updated.designationId,
      domainId: updated.domainId,
    },
    ip: req.ip,
  });

  ok(res, planDto(updated));
});

const updatePlanStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (![PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED].includes(status)) {
    throw ApiError.validationError([
      { field: 'status', message: 'Status must be DRAFT or PUBLISHED.' },
    ]);
  }

  const current = await prisma.internshipPlan.findUnique({ where: { id } });
  if (!current) throw ApiError.notFound('Plan not found.');

  const updated = await prisma.internshipPlan.update({
    where: { id },
    data: { status, updatedBy: req.user.id },
    include: { designation: true, domain: true },
  });

  await addAudit({
    actorId: req.user.id,
    action: `PLAN_${status === PUBLISH_STATUS.PUBLISHED ? 'PUBLISHED' : 'UNPUBLISHED'}`,
    entityType: 'InternshipPlan',
    entityId: updated.id,
    before: { status: current.status },
    after: { status: updated.status },
    ip: req.ip,
  });

  ok(res, planDto(updated));
});

// ─── Assessment Configs (Admin) ──────────────────────────────────────────────

function validateAssessmentQuestions(questions) {
  if (!Array.isArray(questions)) {
    return [{ field: 'questions', message: `Add exactly ${ASSESSMENT_QUESTION_COUNT} questions.` }];
  }
  const details = [];
  if (questions.length !== ASSESSMENT_QUESTION_COUNT) {
    details.push({
      field: 'questions',
      message: `Add exactly ${ASSESSMENT_QUESTION_COUNT} questions (currently ${questions.length}).`,
    });
  }
  questions.forEach((q, i) => {
    const label = `Question ${i + 1}`;
    if (!String(q?.text || '').trim()) {
      details.push({ field: `questions.${i}.text`, message: `${label} needs text.` });
    }
    const options = Array.isArray(q?.options) ? q.options.map((o) => String(o || '').trim()) : [];
    if (options.length !== ASSESSMENT_OPTION_COUNT) {
      details.push({
        field: `questions.${i}.options`,
        message: `${label} needs exactly ${ASSESSMENT_OPTION_COUNT} options.`,
      });
    } else if (options.some((o) => !o)) {
      details.push({ field: `questions.${i}.options`, message: `${label} has an empty option.` });
    } else if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      details.push({ field: `questions.${i}.options`, message: `${label} has duplicate options.` });
    }
    if (
      q?.correctIndex === undefined ||
      q?.correctIndex === null ||
      !Number.isInteger(q.correctIndex) ||
      q.correctIndex < 0 ||
      q.correctIndex >= ASSESSMENT_OPTION_COUNT
    ) {
      details.push({
        field: `questions.${i}.correctIndex`,
        message: `Mark the correct answer for question ${i + 1}.`,
      });
    }
  });
  return details;
}

function validateAssessmentSlabs(slabs) {
  if (!Array.isArray(slabs) || slabs.length === 0) {
    return [{ field: 'discountSlabs', message: 'Add at least one discount slab.' }];
  }
  const details = [];
  slabs.forEach((slab, i) => {
    const label = `Slab ${i + 1}`;
    const min = slab?.minScore;
    const max = slab?.maxScore;
    const minValid = Number.isInteger(min) && min >= 0 && min <= ASSESSMENT_MAX_SCORE;
    const maxValid = Number.isInteger(max) && max >= 0 && max <= ASSESSMENT_MAX_SCORE;
    if (!minValid) {
      details.push({
        field: `discountSlabs.${i}.minScore`,
        message: `${label}: minimum score must be a whole number from 0 to ${ASSESSMENT_MAX_SCORE}.`,
      });
    }
    if (!maxValid) {
      details.push({
        field: `discountSlabs.${i}.maxScore`,
        message: `${label}: maximum score must be a whole number from 0 to ${ASSESSMENT_MAX_SCORE}.`,
      });
    }
    if (minValid && maxValid && min > max) {
      details.push({
        field: `discountSlabs.${i}.maxScore`,
        message: `${label}: maximum score cannot be lower than minimum.`,
      });
    }
    const discount = slab?.discountPercent;
    if (typeof discount !== 'number' || discount < 0 || discount > 100) {
      details.push({
        field: `discountSlabs.${i}.discountPercent`,
        message: `${label}: discount must be between 0 and 100%.`,
      });
    }
  });

  if (details.length > 0) return details;

  const ranges = slabs
    .map((s) => ({ min: Number(s.minScore), max: Number(s.maxScore) }))
    .sort((a, b) => a.min - b.min);

  let widest = ranges[0];
  for (let idx = 1; idx < ranges.length; idx++) {
    const cur = ranges[idx];
    if (cur.min <= widest.max) {
      details.push({
        field: 'discountSlabs',
        message: `Slabs ${widest.min}–${widest.max} and ${cur.min}–${cur.max} overlap.`,
      });
    }
    if (cur.max > widest.max) widest = cur;
  }

  const missing = [];
  for (let score = 0; score <= ASSESSMENT_MAX_SCORE; score++) {
    if (!ranges.some((r) => score >= r.min && score <= r.max)) missing.push(score);
  }
  if (missing.length > 0) {
    details.push({
      field: 'discountSlabs',
      message: `Scores not covered: ${missing.join(', ')}. Slabs must cover 0 to ${ASSESSMENT_MAX_SCORE}.`,
    });
  }

  return details;
}

function parseDraftInput(body) {
  const details = [];
  const questions = [];
  const discountSlabs = [];

  if (!Array.isArray(body?.questions)) {
    details.push({ field: 'questions', message: 'Questions must be a list.' });
  } else if (body.questions.length > ASSESSMENT_QUESTION_COUNT) {
    details.push({
      field: 'questions',
      message: `An assessment has at most ${ASSESSMENT_QUESTION_COUNT} questions.`,
    });
  } else {
    body.questions.forEach((raw, i) => {
      const field = `questions[${i}]`;
      const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
      const options = Array.isArray(raw?.options)
        ? raw.options.map((o) => (typeof o === 'string' ? o.trim() : ''))
        : ['', '', '', ''];
      const correctIndex =
        raw?.correctIndex !== undefined && raw?.correctIndex !== null ? Number(raw.correctIndex) : null;
      questions.push({
        _id: raw?._id || `q_${i + 1}`,
        text,
        options,
        correctIndex,
        marks: Number(raw?.marks) > 0 ? Number(raw.marks) : 1,
      });
    });
  }

  if (!Array.isArray(body?.discountSlabs)) {
    details.push({ field: 'discountSlabs', message: 'Discount slabs must be a list.' });
  } else if (body.discountSlabs.length > MAX_SLABS) {
    details.push({ field: 'discountSlabs', message: `Use at most ${MAX_SLABS} discount slabs.` });
  } else {
    body.discountSlabs.forEach((raw) => {
      discountSlabs.push({
        minScore: raw?.minScore !== undefined ? Number(raw.minScore) : null,
        maxScore: raw?.maxScore !== undefined ? Number(raw.maxScore) : null,
        discountPercent: raw?.discountPercent !== undefined ? Number(raw.discountPercent) : null,
      });
    });
  }

  return { questions, discountSlabs, details };
}

const listAdminAssessments = asyncHandler(async (_req, res) => {
  const designations = await prisma.designation.findMany({
    orderBy: { name: 'asc' },
  });

  const configs = await prisma.assessmentConfig.findMany({
    orderBy: { version: 'desc' },
  });

  const summaries = designations.map((desig) => {
    const desigConfigs = configs.filter((c) => c.designationId === desig.id);
    const latest = desigConfigs[0] || null;
    const published = desigConfigs.find((c) => c.status === SCHEDULE_STATUS.PUBLISHED) || null;

    let questionCount = 0;
    if (latest?.questions) {
      const qList = Array.isArray(latest.questions) ? latest.questions : JSON.parse(latest.questions);
      questionCount = qList.length;
    }

    return {
      designationId: desig.id,
      designation: { _id: desig.id, name: desig.name, slug: desig.slug },
      configId: latest ? latest.id : null,
      version: latest ? latest.version : null,
      status: latest ? latest.status : null,
      questionCount,
      publishedVersion: published ? published.version : null,
      updatedAt: latest ? latest.updatedAt : null,
    };
  });

  ok(res, summaries);
});

const getAdminAssessment = asyncHandler(async (req, res) => {
  const { designationId } = req.params;
  const designation = await prisma.designation.findUnique({ where: { id: designationId } });
  if (!designation) throw ApiError.notFound('Designation not found.');

  const configs = await prisma.assessmentConfig.findMany({
    where: { designationId },
    orderBy: { version: 'desc' },
  });

  const latest = configs[0] || null;
  const published = configs.find((c) => c.status === SCHEDULE_STATUS.PUBLISHED) || null;

  if (!latest) {
    return ok(res, {
      _id: null,
      designationId,
      designation: { _id: designation.id, name: designation.name, slug: designation.slug },
      version: 0,
      status: SCHEDULE_STATUS.DRAFT,
      publishedVersion: null,
      questions: [],
      discountSlabs: [],
      updatedAt: null,
    });
  }

  const questions = Array.isArray(latest.questions) ? latest.questions : JSON.parse(latest.questions || '[]');
  const discountSlabs = Array.isArray(latest.discountSlabs)
    ? latest.discountSlabs
    : JSON.parse(latest.discountSlabs || '[]');

  ok(res, {
    _id: latest.id,
    designationId,
    designation: { _id: designation.id, name: designation.name, slug: designation.slug },
    version: latest.version,
    status: latest.status,
    publishedVersion: published ? published.version : null,
    questions,
    discountSlabs,
    updatedAt: latest.updatedAt,
  });
});

const saveAssessmentDraft = asyncHandler(async (req, res) => {
  const { designationId } = req.params;
  const designation = await prisma.designation.findUnique({ where: { id: designationId } });
  if (!designation) throw ApiError.notFound('Designation not found.');

  const { questions, discountSlabs, details } = parseDraftInput(req.body);
  if (details.length > 0) throw ApiError.validationError(details);

  const latest = await prisma.assessmentConfig.findFirst({
    where: { designationId },
    orderBy: { version: 'desc' },
  });

  let config;
  if (!latest || latest.status !== SCHEDULE_STATUS.DRAFT) {
    // Create new version as DRAFT
    const nextVersion = (latest?.version || 0) + 1;
    config = await prisma.assessmentConfig.create({
      data: {
        designationId,
        version: nextVersion,
        status: SCHEDULE_STATUS.DRAFT,
        questions,
        discountSlabs,
        createdBy: req.user.id,
      },
    });
  } else {
    // Update existing DRAFT
    config = await prisma.assessmentConfig.update({
      where: { id: latest.id },
      data: { questions, discountSlabs },
    });
  }

  await addAudit({
    actorId: req.user.id,
    action: 'ASSESSMENT_DRAFT_SAVED',
    entityType: 'AssessmentConfig',
    entityId: config.id,
    after: { version: config.version, status: config.status },
    ip: req.ip,
  });

  const published = await prisma.assessmentConfig.findFirst({
    where: { designationId, status: SCHEDULE_STATUS.PUBLISHED },
    orderBy: { version: 'desc' },
  });

  ok(res, {
    _id: config.id,
    designationId,
    designation: { _id: designation.id, name: designation.name, slug: designation.slug },
    version: config.version,
    status: config.status,
    publishedVersion: published ? published.version : null,
    questions,
    discountSlabs,
    updatedAt: config.updatedAt,
  });
});

const publishAssessment = asyncHandler(async (req, res) => {
  const { designationId } = req.params;
  const designation = await prisma.designation.findUnique({ where: { id: designationId } });
  if (!designation) throw ApiError.notFound('Designation not found.');

  const latest = await prisma.assessmentConfig.findFirst({
    where: { designationId },
    orderBy: { version: 'desc' },
  });

  if (!latest) throw ApiError.notFound('No assessment config found to publish.');

  const questions = Array.isArray(latest.questions) ? latest.questions : JSON.parse(latest.questions || '[]');
  const discountSlabs = Array.isArray(latest.discountSlabs)
    ? latest.discountSlabs
    : JSON.parse(latest.discountSlabs || '[]');

  const qDetails = validateAssessmentQuestions(questions);
  const sDetails = validateAssessmentSlabs(discountSlabs);
  const allDetails = [...qDetails, ...sDetails];
  if (allDetails.length > 0) throw ApiError.validationError(allDetails);

  // Archive any currently published versions and mark latest as PUBLISHED
  await prisma.$transaction([
    prisma.assessmentConfig.updateMany({
      where: {
        designationId,
        status: SCHEDULE_STATUS.PUBLISHED,
        id: { not: latest.id },
      },
      data: { status: SCHEDULE_STATUS.ARCHIVED },
    }),
    prisma.assessmentConfig.update({
      where: { id: latest.id },
      data: {
        status: SCHEDULE_STATUS.PUBLISHED,
        publishedAt: new Date(),
      },
    }),
  ]);

  await addAudit({
    actorId: req.user.id,
    action: 'ASSESSMENT_PUBLISHED',
    entityType: 'AssessmentConfig',
    entityId: latest.id,
    after: { version: latest.version, status: SCHEDULE_STATUS.PUBLISHED },
    ip: req.ip,
  });

  ok(res, {
    _id: latest.id,
    designationId,
    designation: { _id: designation.id, name: designation.name, slug: designation.slug },
    version: latest.version,
    status: SCHEDULE_STATUS.PUBLISHED,
    publishedVersion: latest.version,
    questions,
    discountSlabs,
    updatedAt: new Date(),
  });
});

module.exports = {
  listAdminDesignations,
  createDesignation,
  updateDesignation,
  updateDesignationStatus,
  listAdminDomains,
  createDomain,
  updateDomain,
  updateDomainStatus,
  listAdminPlans,
  createPlan,
  updatePlan,
  updatePlanStatus,
  listAdminAssessments,
  getAdminAssessment,
  saveAssessmentDraft,
  publishAssessment,
};
