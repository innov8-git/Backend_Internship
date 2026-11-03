const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  noContent,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const {
  ROLES,
  SCHEDULE_STATUS,
  PAYMENT_STATUS,
  ENROLLMENT_STATUS,
  TASK_STATUS,
  DURATION_OPTIONS,
  MEMBER_STATUS,
} = require('../../common/constants');
const { addAudit } = require('../audit-log/audit-log.service');

// Simple Markdown to HTML converter for SOP content
function renderSimpleMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold & Italics
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Unordered Lists
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');

  // Paragraphs
  html = html
    .split(/\n\n+/)
    .map((p) => {
      p = p.trim();
      if (!p) return '';
      if (p.startsWith('<h') || p.startsWith('<ul>') || p.startsWith('<ol>')) return p;
      return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  return html;
}

// ─── Access Checks ───────────────────────────────────────────────────────────

async function canAccessEnrollment(user, enrollment) {
  if (enrollment.userId === user.id) return true;
  if (user.roles.includes(ROLES.ADMIN)) return true;
  if (!enrollment.teamId) return false;

  const team = await prisma.team.findUnique({
    where: { id: enrollment.teamId },
    include: { members: true },
  });

  if (!team) return false;
  if (team.leaderId === user.id) return true;
  return team.members.some(
    (m) => m.userId === user.id && m.status === MEMBER_STATUS.JOINED,
  );
}

function isEnrollmentUnlocked(enrollment) {
  const activeStatuses = [
    ENROLLMENT_STATUS.ACTIVE,
    ENROLLMENT_STATUS.IN_PROGRESS,
    ENROLLMENT_STATUS.COMPLETED,
  ];
  return activeStatuses.includes(enrollment.status);
}

// ─── Student Learning Handlers ───────────────────────────────────────────────

const getStudentSchedule = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    include: {
      plan: { include: { designation: true, domain: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      taskProgress: {
        include: { task: true },
      },
    },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found.');

  const hasAccess = await canAccessEnrollment(req.user, enrollment);
  if (!hasAccess) throw ApiError.forbidden('FORBIDDEN', 'Access denied.');

  if (!isEnrollmentUnlocked(enrollment)) {
    throw ApiError.forbidden(
      'ENROLLMENT_NOT_ACTIVE',
      'Complete payment to unlock the schedule, SOPs and tasks.',
    );
  }

  // Resolve template
  let template = null;
  if (enrollment.scheduleTemplateId) {
    template = await prisma.scheduleTemplate.findUnique({
      where: { id: enrollment.scheduleTemplateId },
    });
  }
  if (!template && enrollment.plan) {
    template = await prisma.scheduleTemplate.findFirst({
      where: {
        designationId: enrollment.plan.designationId,
        domainId: enrollment.plan.domainId,
        durationMonths: enrollment.plan.durationMonths,
        status: SCHEDULE_STATUS.PUBLISHED,
      },
      orderBy: { version: 'desc' },
    });
  }

  let rawDays = [];
  if (template?.days) {
    rawDays = Array.isArray(template.days) ? template.days : JSON.parse(template.days || '[]');
  }
  const days = rawDays.sort((a, b) => Number(a.dayNumber) - Number(b.dayNumber));

  // Map progress by dayNumber
  const progressList = enrollment.taskProgress || [];
  const taskMap = new Map();
  progressList.forEach((p) => {
    if (p.task && p.task.dayNumber) {
      taskMap.set(p.task.dayNumber, {
        progressId: p.id,
        title: p.task.title,
        status: p.status,
      });
    }
  });

  const formattedDays = days.map((day) => {
    const dayNum = Number(day.dayNumber);
    const task = taskMap.get(dayNum) || null;
    const completed = task
      ? task.status === TASK_STATUS.APPROVED
      : progressList
          .filter((p) => p.task?.dayNumber && p.task.dayNumber < dayNum)
          .every((p) => p.status === TASK_STATUS.APPROVED);

    return {
      dayNumber: dayNum,
      title: day.title || `Day ${dayNum}`,
      activity: day.activity || '',
      requiredEvidence: day.requiredEvidence || '',
      hasSop: Boolean(day.sopContent && String(day.sopContent).trim()),
      task,
      completed,
    };
  });

  ok(res, {
    enrollmentId: enrollment.id,
    scheduleTemplateId: template ? template.id : null,
    version: template ? template.version : enrollment.scheduleVersion,
    totalDays: formattedDays.length,
    days: formattedDays,
  });
});

const getDaySop = asyncHandler(async (req, res) => {
  const { id, dayNumber } = req.params;
  const dayNum = parseInt(dayNumber, 10);
  if (Number.isNaN(dayNum) || dayNum < 1) {
    throw ApiError.badRequest('INVALID_DAY', 'Valid day number required.');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    include: { plan: true },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found.');

  const hasAccess = await canAccessEnrollment(req.user, enrollment);
  if (!hasAccess) throw ApiError.forbidden('FORBIDDEN', 'Access denied.');

  if (!isEnrollmentUnlocked(enrollment)) {
    throw ApiError.forbidden(
      'ENROLLMENT_NOT_ACTIVE',
      'Complete payment to unlock the schedule, SOPs and tasks.',
    );
  }

  let template = null;
  if (enrollment.scheduleTemplateId) {
    template = await prisma.scheduleTemplate.findUnique({
      where: { id: enrollment.scheduleTemplateId },
    });
  }
  if (!template && enrollment.plan) {
    template = await prisma.scheduleTemplate.findFirst({
      where: {
        designationId: enrollment.plan.designationId,
        domainId: enrollment.plan.domainId,
        durationMonths: enrollment.plan.durationMonths,
        status: SCHEDULE_STATUS.PUBLISHED,
      },
      orderBy: { version: 'desc' },
    });
  }

  let rawDays = [];
  if (template?.days) {
    rawDays = Array.isArray(template.days) ? template.days : JSON.parse(template.days || '[]');
  }

  const day = rawDays.find((d) => Number(d.dayNumber) === dayNum);
  if (!day) {
    throw ApiError.notFound('Schedule day not found.');
  }

  // MM15: Log SOP access
  await prisma.sopAccessLog.create({
    data: {
      userId: req.user.id,
      enrollmentId: enrollment.id,
      dayNumber: dayNum,
      ip: req.ip || null,
    },
  });

  res.set('Cache-Control', 'no-store');
  ok(res, {
    dayNumber: dayNum,
    title: day.title || `Day ${dayNum}`,
    contentHtml: renderSimpleMarkdown(day.sopContent || ''),
    watermarkText: `${req.user.name} · ID ${req.user.id.slice(-6).toUpperCase()}`,
  });
});

// ─── Admin Schedule Templates ────────────────────────────────────────────────

const listAdminSchedules = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
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

  const [total, templates] = await Promise.all([
    prisma.scheduleTemplate.count({ where }),
    prisma.scheduleTemplate.findMany({
      where,
      include: {
        designation: true,
        domain: true,
        taskDefinitions: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  const items = templates.map((t) => {
    let days = [];
    if (t.days) {
      days = Array.isArray(t.days) ? t.days : JSON.parse(t.days || '[]');
    }
    return {
      _id: t.id,
      designationId: t.designationId,
      domainId: t.domainId,
      durationMonths: t.durationMonths,
      version: t.version,
      status: t.status,
      totalDays: days.length,
      taskCount: t.taskDefinitions.length,
      publishedAt: t.publishedAt,
      updatedAt: t.updatedAt,
      designation: t.designation ? { _id: t.designation.id, name: t.designation.name, slug: t.designation.slug } : null,
      domain: t.domain ? { _id: t.domain.id, name: t.domain.name, slug: t.domain.slug } : null,
    };
  });

  ok(res, paginatedResponse(items, total, page, limit));
});

const createAdminSchedule = asyncHandler(async (req, res) => {
  const { designationId, domainId, durationMonths, days } = req.body;
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

  const rawDays = Array.isArray(days) ? days : [];
  if (details.length > 0) throw ApiError.validationError(details);

  const highest = await prisma.scheduleTemplate.findFirst({
    where: {
      designationId,
      domainId,
      durationMonths: Number(durationMonths),
    },
    orderBy: { version: 'desc' },
  });

  const nextVersion = (highest?.version || 0) + 1;

  const template = await prisma.scheduleTemplate.create({
    data: {
      designationId,
      domainId,
      durationMonths: Number(durationMonths),
      version: nextVersion,
      status: SCHEDULE_STATUS.DRAFT,
      days: rawDays,
      createdBy: req.user.id,
    },
    include: { designation: true, domain: true },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'SCHEDULE_CREATED',
    entityType: 'ScheduleTemplate',
    entityId: template.id,
    after: { version: template.version, status: template.status },
    ip: req.ip,
  });

  created(res, {
    _id: template.id,
    designationId: template.designationId,
    domainId: template.domainId,
    durationMonths: template.durationMonths,
    version: template.version,
    status: template.status,
    days: rawDays,
    designation: { _id: designation.id, name: designation.name, slug: designation.slug },
    domain: { _id: domain.id, name: domain.name, slug: domain.slug },
    updatedAt: template.updatedAt,
  });
});

const getAdminScheduleById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const template = await prisma.scheduleTemplate.findUnique({
    where: { id },
    include: {
      designation: true,
      domain: true,
      taskDefinitions: { orderBy: { sequence: 'asc' } },
    },
  });

  if (!template) throw ApiError.notFound('Schedule template not found.');

  let days = [];
  if (template.days) {
    days = Array.isArray(template.days) ? template.days : JSON.parse(template.days || '[]');
  }

  ok(res, {
    _id: template.id,
    designationId: template.designationId,
    domainId: template.domainId,
    durationMonths: template.durationMonths,
    version: template.version,
    status: template.status,
    days,
    taskDefinitions: template.taskDefinitions.map((t) => ({
      _id: t.id,
      templateId: t.templateId,
      sequence: t.sequence,
      dayNumber: t.dayNumber,
      title: t.title,
      problemStatement: t.problemStatement,
      expectedOutcome: t.expectedOutcome,
      acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : JSON.parse(t.acceptanceCriteria || '[]'),
      starterRepoUrl: t.starterRepoUrl,
      estimatedHours: t.estimatedHours,
      requiresTrainerReview: t.requiresTrainerReview,
      prerequisiteTaskIds: Array.isArray(t.prerequisiteTaskIds) ? t.prerequisiteTaskIds : JSON.parse(t.prerequisiteTaskIds || '[]'),
    })),
    designation: template.designation
      ? { _id: template.designation.id, name: template.designation.name, slug: template.designation.slug }
      : null,
    domain: template.domain
      ? { _id: template.domain.id, name: template.domain.name, slug: template.domain.slug }
      : null,
    updatedAt: template.updatedAt,
    publishedAt: template.publishedAt,
  });
});

const updateAdminSchedule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { days } = req.body;

  const template = await prisma.scheduleTemplate.findUnique({ where: { id } });
  if (!template) throw ApiError.notFound('Schedule template not found.');

  if (template.status === SCHEDULE_STATUS.PUBLISHED) {
    throw ApiError.conflict(
      'TEMPLATE_PUBLISHED',
      'Published schedules are immutable. Clone to a draft to make changes.',
    );
  }

  const rawDays = Array.isArray(days) ? days : [];
  const updated = await prisma.scheduleTemplate.update({
    where: { id },
    data: { days: rawDays },
    include: { designation: true, domain: true },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'SCHEDULE_UPDATED',
    entityType: 'ScheduleTemplate',
    entityId: updated.id,
    ip: req.ip,
  });

  ok(res, {
    _id: updated.id,
    designationId: updated.designationId,
    domainId: updated.domainId,
    durationMonths: updated.durationMonths,
    version: updated.version,
    status: updated.status,
    days: rawDays,
    updatedAt: updated.updatedAt,
  });
});

const publishAdminSchedule = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const template = await prisma.scheduleTemplate.findUnique({
    where: { id },
    include: { taskDefinitions: true },
  });
  if (!template) throw ApiError.notFound('Schedule template not found.');

  let days = [];
  if (template.days) {
    days = Array.isArray(template.days) ? template.days : JSON.parse(template.days || '[]');
  }

  if (days.length === 0) {
    throw ApiError.validationError([{ field: 'days', message: 'Add at least one day before publishing.' }]);
  }
  if (template.taskDefinitions.length === 0) {
    throw ApiError.validationError([{ field: 'tasks', message: 'Add at least one task before publishing.' }]);
  }

  // Archive previous published version and publish this one
  await prisma.$transaction([
    prisma.scheduleTemplate.updateMany({
      where: {
        designationId: template.designationId,
        domainId: template.domainId,
        durationMonths: template.durationMonths,
        status: SCHEDULE_STATUS.PUBLISHED,
        id: { not: id },
      },
      data: { status: SCHEDULE_STATUS.ARCHIVED },
    }),
    prisma.scheduleTemplate.update({
      where: { id },
      data: {
        status: SCHEDULE_STATUS.PUBLISHED,
        publishedAt: new Date(),
      },
    }),
  ]);

  await addAudit({
    actorId: req.user.id,
    action: 'SCHEDULE_PUBLISHED',
    entityType: 'ScheduleTemplate',
    entityId: template.id,
    after: { version: template.version, status: SCHEDULE_STATUS.PUBLISHED },
    ip: req.ip,
  });

  ok(res, {
    _id: template.id,
    version: template.version,
    status: SCHEDULE_STATUS.PUBLISHED,
    publishedAt: new Date(),
  });
});

const listScheduleVersions = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const template = await prisma.scheduleTemplate.findUnique({ where: { id } });
  if (!template) throw ApiError.notFound('Schedule template not found.');

  const versions = await prisma.scheduleTemplate.findMany({
    where: {
      designationId: template.designationId,
      domainId: template.domainId,
      durationMonths: template.durationMonths,
    },
    include: { taskDefinitions: true },
    orderBy: { version: 'desc' },
  });

  ok(
    res,
    versions.map((v) => ({
      _id: v.id,
      version: v.version,
      status: v.status,
      publishedAt: v.publishedAt,
      updatedAt: v.updatedAt,
      taskCount: v.taskDefinitions.length,
    })),
  );
});

const cloneAdminSchedule = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const source = await prisma.scheduleTemplate.findUnique({
    where: { id },
    include: { taskDefinitions: { orderBy: { sequence: 'asc' } } },
  });
  if (!source) throw ApiError.notFound('Schedule template not found.');

  const highest = await prisma.scheduleTemplate.findFirst({
    where: {
      designationId: source.designationId,
      domainId: source.domainId,
      durationMonths: source.durationMonths,
    },
    orderBy: { version: 'desc' },
  });

  const nextVersion = (highest?.version || 0) + 1;

  // Create clone
  const newTemplate = await prisma.scheduleTemplate.create({
    data: {
      designationId: source.designationId,
      domainId: source.domainId,
      durationMonths: source.durationMonths,
      version: nextVersion,
      status: SCHEDULE_STATUS.DRAFT,
      days: source.days,
      createdBy: req.user.id,
    },
  });

  // Remap task IDs
  const idMap = new Map();
  for (const task of source.taskDefinitions) {
    const newTask = await prisma.taskDefinition.create({
      data: {
        templateId: newTemplate.id,
        templateVersion: nextVersion,
        sequence: task.sequence,
        dayNumber: task.dayNumber,
        title: task.title,
        problemStatement: task.problemStatement,
        expectedOutcome: task.expectedOutcome,
        acceptanceCriteria: task.acceptanceCriteria,
        starterRepoUrl: task.starterRepoUrl,
        estimatedHours: task.estimatedHours,
        requiresTrainerReview: task.requiresTrainerReview,
        prerequisiteTaskIds: [],
        createdBy: req.user.id,
      },
    });
    idMap.set(task.id, newTask.id);
  }

  // Update remapped prerequisiteTaskIds
  for (const task of source.taskDefinitions) {
    let prereqs = [];
    if (task.prerequisiteTaskIds) {
      prereqs = Array.isArray(task.prerequisiteTaskIds)
        ? task.prerequisiteTaskIds
        : JSON.parse(task.prerequisiteTaskIds || '[]');
    }
    const newPrereqs = prereqs.map((pid) => idMap.get(pid)).filter(Boolean);
    const newTaskId = idMap.get(task.id);
    if (newTaskId && newPrereqs.length > 0) {
      await prisma.taskDefinition.update({
        where: { id: newTaskId },
        data: { prerequisiteTaskIds: newPrereqs },
      });
    }
  }

  await addAudit({
    actorId: req.user.id,
    action: 'SCHEDULE_CLONED',
    entityType: 'ScheduleTemplate',
    entityId: newTemplate.id,
    after: { sourceId: source.id, version: newTemplate.version },
    ip: req.ip,
  });

  created(res, {
    _id: newTemplate.id,
    version: newTemplate.version,
    status: newTemplate.status,
  });
});

// ─── Admin Task Definitions ──────────────────────────────────────────────────

const listScheduleTasks = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const tasks = await prisma.taskDefinition.findMany({
    where: { templateId: id },
    orderBy: { sequence: 'asc' },
  });

  ok(
    res,
    tasks.map((t) => ({
      _id: t.id,
      templateId: t.templateId,
      sequence: t.sequence,
      dayNumber: t.dayNumber,
      title: t.title,
      problemStatement: t.problemStatement,
      expectedOutcome: t.expectedOutcome,
      acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : JSON.parse(t.acceptanceCriteria || '[]'),
      starterRepoUrl: t.starterRepoUrl,
      estimatedHours: t.estimatedHours,
      requiresTrainerReview: t.requiresTrainerReview,
      prerequisiteTaskIds: Array.isArray(t.prerequisiteTaskIds) ? t.prerequisiteTaskIds : JSON.parse(t.prerequisiteTaskIds || '[]'),
      updatedAt: t.updatedAt,
    })),
  );
});

const reorderScheduleTasks = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw ApiError.validationError([{ field: 'orderedIds', message: 'orderedIds must be a non-empty array.' }]);
  }

  const template = await prisma.scheduleTemplate.findUnique({ where: { id } });
  if (!template) throw ApiError.notFound('Schedule template not found.');
  if (template.status === SCHEDULE_STATUS.PUBLISHED) {
    throw ApiError.conflict('TEMPLATE_PUBLISHED', 'Published templates cannot be modified.');
  }

  for (let i = 0; i < orderedIds.length; i++) {
    await prisma.taskDefinition.update({
      where: { id: orderedIds[i] },
      data: { sequence: i + 1 },
    });
  }

  ok(res, { message: 'Tasks reordered successfully.' });
});

const createTaskDefinition = asyncHandler(async (req, res) => {
  const {
    templateId,
    dayNumber,
    title,
    problemStatement,
    expectedOutcome,
    acceptanceCriteria,
    starterRepoUrl,
    estimatedHours,
    requiresTrainerReview,
    prerequisiteTaskIds,
  } = req.body;

  const template = await prisma.scheduleTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw ApiError.notFound('Schedule template not found.');
  if (template.status === SCHEDULE_STATUS.PUBLISHED) {
    throw ApiError.conflict('TEMPLATE_PUBLISHED', 'Cannot add tasks to a published template.');
  }

  const details = [];
  if (!title || title.trim().length < 2) {
    details.push({ field: 'title', message: 'Task title must be at least 2 characters.' });
  }
  if (details.length > 0) throw ApiError.validationError(details);

  const highestSeq = await prisma.taskDefinition.findFirst({
    where: { templateId },
    orderBy: { sequence: 'desc' },
  });
  const sequence = (highestSeq?.sequence || 0) + 1;

  const task = await prisma.taskDefinition.create({
    data: {
      templateId,
      templateVersion: template.version,
      sequence,
      dayNumber: dayNumber ? Number(dayNumber) : null,
      title: title.trim(),
      problemStatement: problemStatement || '',
      expectedOutcome: expectedOutcome || '',
      acceptanceCriteria: Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [],
      starterRepoUrl: starterRepoUrl || null,
      estimatedHours: estimatedHours ? Number(estimatedHours) : null,
      requiresTrainerReview: requiresTrainerReview !== false,
      prerequisiteTaskIds: Array.isArray(prerequisiteTaskIds) ? prerequisiteTaskIds : [],
      createdBy: req.user.id,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'TASK_CREATED',
    entityType: 'TaskDefinition',
    entityId: task.id,
    after: { title: task.title, sequence: task.sequence },
    ip: req.ip,
  });

  created(res, {
    _id: task.id,
    templateId: task.templateId,
    sequence: task.sequence,
    dayNumber: task.dayNumber,
    title: task.title,
    problemStatement: task.problemStatement,
    expectedOutcome: task.expectedOutcome,
    acceptanceCriteria: task.acceptanceCriteria,
    starterRepoUrl: task.starterRepoUrl,
    estimatedHours: task.estimatedHours,
    requiresTrainerReview: task.requiresTrainerReview,
    prerequisiteTaskIds: task.prerequisiteTaskIds,
  });
});

const updateTaskDefinition = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const task = await prisma.taskDefinition.findUnique({
    where: { id },
    include: { template: true },
  });

  if (!task) throw ApiError.notFound('Task definition not found.');
  if (task.template.status === SCHEDULE_STATUS.PUBLISHED) {
    throw ApiError.conflict('TEMPLATE_PUBLISHED', 'Cannot modify tasks of a published template.');
  }

  const {
    dayNumber,
    title,
    problemStatement,
    expectedOutcome,
    acceptanceCriteria,
    starterRepoUrl,
    estimatedHours,
    requiresTrainerReview,
    prerequisiteTaskIds,
  } = req.body;

  const updated = await prisma.taskDefinition.update({
    where: { id },
    data: {
      ...(dayNumber !== undefined && { dayNumber: dayNumber ? Number(dayNumber) : null }),
      ...(title !== undefined && { title: title.trim() }),
      ...(problemStatement !== undefined && { problemStatement }),
      ...(expectedOutcome !== undefined && { expectedOutcome }),
      ...(acceptanceCriteria !== undefined && { acceptanceCriteria }),
      ...(starterRepoUrl !== undefined && { starterRepoUrl }),
      ...(estimatedHours !== undefined && { estimatedHours: estimatedHours ? Number(estimatedHours) : null }),
      ...(requiresTrainerReview !== undefined && { requiresTrainerReview: Boolean(requiresTrainerReview) }),
      ...(prerequisiteTaskIds !== undefined && { prerequisiteTaskIds }),
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'TASK_UPDATED',
    entityType: 'TaskDefinition',
    entityId: updated.id,
    ip: req.ip,
  });

  ok(res, {
    _id: updated.id,
    templateId: updated.templateId,
    sequence: updated.sequence,
    dayNumber: updated.dayNumber,
    title: updated.title,
    problemStatement: updated.problemStatement,
    expectedOutcome: updated.expectedOutcome,
    acceptanceCriteria: updated.acceptanceCriteria,
    starterRepoUrl: updated.starterRepoUrl,
    estimatedHours: updated.estimatedHours,
    requiresTrainerReview: updated.requiresTrainerReview,
    prerequisiteTaskIds: updated.prerequisiteTaskIds,
  });
});

const deleteTaskDefinition = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const task = await prisma.taskDefinition.findUnique({
    where: { id },
    include: { template: true },
  });

  if (!task) throw ApiError.notFound('Task definition not found.');
  if (task.template.status === SCHEDULE_STATUS.PUBLISHED) {
    throw ApiError.conflict('TEMPLATE_PUBLISHED', 'Cannot delete tasks of a published template.');
  }

  await prisma.taskDefinition.delete({ where: { id } });

  // Re-sequence remaining tasks
  const remaining = await prisma.taskDefinition.findMany({
    where: { templateId: task.templateId },
    orderBy: { sequence: 'asc' },
  });

  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].sequence !== i + 1) {
      await prisma.taskDefinition.update({
        where: { id: remaining[i].id },
        data: { sequence: i + 1 },
      });
    }
  }

  await addAudit({
    actorId: req.user.id,
    action: 'TASK_DELETED',
    entityType: 'TaskDefinition',
    entityId: id,
    ip: req.ip,
  });

  noContent(res);
});

module.exports = {
  getStudentSchedule,
  getDaySop,
  listAdminSchedules,
  createAdminSchedule,
  getAdminScheduleById,
  updateAdminSchedule,
  publishAdminSchedule,
  listScheduleVersions,
  cloneAdminSchedule,
  listScheduleTasks,
  reorderScheduleTasks,
  createTaskDefinition,
  updateTaskDefinition,
  deleteTaskDefinition,
};
