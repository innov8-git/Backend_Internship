'use strict';

const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  parseSort,
  paginatedResponse,
  uniqueSlug,
} = require('../../utils');
const { PUBLISH_STATUS } = require('../../common/constants');
const { addAudit } = require('../audit-log/audit-log.service');

function projectDto(project) {
  if (!project) return null;
  return {
    _id: project.id,
    title: project.title,
    slug: project.slug,
    domainId: project.domainId,
    domain: project.domain
      ? {
          _id: project.domain.id,
          name: project.domain.name,
          slug: project.domain.slug,
        }
      : null,
    designationId: project.designationId || null,
    designation: project.designation
      ? {
          _id: project.designation.id,
          name: project.designation.name,
          slug: project.designation.slug,
        }
      : null,
    starterRepoUrl: project.starterRepoUrl || '',
    appStarterRepoUrl: project.appStarterRepoUrl || '',
    technologies: Array.isArray(project.technologies) ? project.technologies : [],
    webTechStack: Array.isArray(project.webTechStack) ? project.webTechStack : [],
    webDeliverables: project.webDeliverables || '',
    appTechStack: Array.isArray(project.appTechStack) ? project.appTechStack : [],
    appDeliverables: project.appDeliverables || '',
    durationsSupported: Array.isArray(project.durationsSupported)
      ? project.durationsSupported
      : [1, 2, 3, 6],
    isDefault: Boolean(project.isDefault),
    status: project.status || PUBLISH_STATUS.PUBLISHED,
    description: project.description || '',
    taskTemplates: project.taskTemplates || null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function assignmentDto(enrollment) {
  if (!enrollment) return null;
  const student = enrollment.user;
  const plan = enrollment.plan;
  const domain = plan?.domain;
  const designation = plan?.designation;
  const durationMonths = plan?.durationMonths || 2;
  const workingDays =
    durationMonths === 1 ? 20 : durationMonths === 2 ? 40 : durationMonths === 3 ? 60 : 120;

  return {
    enrollmentId: enrollment.id,
    student: student
      ? {
          _id: student.id,
          name: student.name,
          email: student.email,
          avatarUrl: null,
        }
      : null,
    domain: domain
      ? {
          _id: domain.id,
          name: domain.name,
          slug: domain.slug,
        }
      : null,
    designation: designation
      ? {
          _id: designation.id,
          name: designation.name,
          slug: designation.slug,
        }
      : null,
    durationMonths,
    workingDays,
    track: enrollment.track || 'web',
    enrollmentStatus: enrollment.status,
    projectId: enrollment.projectId || null,
    project: enrollment.project ? projectDto(enrollment.project) : null,
    assignedAt: enrollment.projectAssignedAt || null,
    createdAt: enrollment.createdAt,
  };
}

// ─── Project Management ──────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/projects
 */
const listAdminProjects = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
  const { domainId, designationId, status, search } = req.query;

  const where = {
    ...(domainId && { domainId: String(domainId) }),
    ...(designationId && { designationId: String(designationId) }),
    ...(status && { status: String(status) }),
    ...(search && {
      OR: [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } },
        { slug: { contains: String(search), mode: 'insensitive' } },
      ],
    }),
  };

  const { field, order } = parseSort(req.query.sort, 'createdAt:desc', [
    'title',
    'createdAt',
    'status',
  ]);

  const [total, items] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      include: {
        domain: true,
        designation: true,
      },
      orderBy: { [field]: order },
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(items.map(projectDto), total, page, limit));
});

/**
 * GET /api/v1/admin/projects/:id
 */
const getAdminProject = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const project = await prisma.project.findFirst({
    where: {
      OR: [{ id }, { slug: id }],
    },
    include: {
      domain: true,
      designation: true,
    },
  });

  if (!project) {
    throw ApiError.notFound('Project not found.');
  }

  ok(res, projectDto(project));
});

/**
 * POST /api/v1/admin/projects
 */
const createProject = asyncHandler(async (req, res) => {
  const {
    title,
    domainId,
    designationId,
    starterRepoUrl,
    appStarterRepoUrl,
    description,
    technologies,
    webTechStack,
    webDeliverables,
    appTechStack,
    appDeliverables,
    durationsSupported,
    isDefault,
    status,
  } = req.body;

  const details = [];

  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle || cleanTitle.length < 3 || cleanTitle.length > 100) {
    details.push({ field: 'title', message: 'Title must be between 3 and 100 characters.' });
  }

  if (!domainId) {
    details.push({ field: 'domainId', message: 'Domain is required.' });
  } else {
    const domain = await prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) {
      details.push({ field: 'domainId', message: 'Selected domain does not exist.' });
    }
  }

  if (designationId) {
    const designation = await prisma.designation.findUnique({ where: { id: designationId } });
    if (!designation) {
      details.push({ field: 'designationId', message: 'Selected designation does not exist.' });
    }
  }

  if (details.length > 0) {
    throw ApiError.validationError(details);
  }

  const slug = await uniqueSlug(prisma.project, cleanTitle);

  // If set to default, unmark other defaults in this domain
  if (isDefault) {
    await prisma.project.updateMany({
      where: { domainId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const project = await prisma.project.create({
    data: {
      title: cleanTitle,
      slug,
      domainId,
      designationId: designationId || null,
      starterRepoUrl: starterRepoUrl?.trim() || '',
      appStarterRepoUrl: appStarterRepoUrl?.trim() || '',
      description: description?.trim() || '',
      technologies: Array.isArray(technologies) ? technologies : [],
      webTechStack: Array.isArray(webTechStack)
        ? webTechStack
        : Array.isArray(technologies)
        ? technologies
        : [],
      webDeliverables: webDeliverables?.trim() || '',
      appTechStack: Array.isArray(appTechStack) ? appTechStack : [],
      appDeliverables: appDeliverables?.trim() || '',
      durationsSupported:
        Array.isArray(durationsSupported) && durationsSupported.length > 0
          ? durationsSupported
          : [1, 2, 3, 6],
      isDefault: Boolean(isDefault),
      status: status === PUBLISH_STATUS.DRAFT ? PUBLISH_STATUS.DRAFT : PUBLISH_STATUS.PUBLISHED,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    },
    include: {
      domain: true,
      designation: true,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'PROJECT_CREATED',
    entityType: 'Project',
    entityId: project.id,
    after: projectDto(project),
    ip: req.ip,
  });

  created(res, projectDto(project));
});

/**
 * PUT /api/v1/admin/projects/:id
 */
const updateProject = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const current = await prisma.project.findUnique({
    where: { id },
    include: { domain: true, designation: true },
  });

  if (!current) {
    throw ApiError.notFound('Project not found.');
  }

  const {
    title,
    domainId,
    designationId,
    starterRepoUrl,
    appStarterRepoUrl,
    description,
    technologies,
    webTechStack,
    webDeliverables,
    appTechStack,
    appDeliverables,
    durationsSupported,
    isDefault,
    status,
  } = req.body;

  const details = [];

  const cleanTitle = typeof title === 'string' ? title.trim() : current.title;
  if (!cleanTitle || cleanTitle.length < 3 || cleanTitle.length > 100) {
    details.push({ field: 'title', message: 'Title must be between 3 and 100 characters.' });
  }

  const targetDomainId = domainId || current.domainId;
  const domain = await prisma.domain.findUnique({ where: { id: targetDomainId } });
  if (!domain) {
    details.push({ field: 'domainId', message: 'Selected domain does not exist.' });
  }

  const targetDesignationId =
    designationId !== undefined ? designationId : current.designationId;
  if (targetDesignationId) {
    const designation = await prisma.designation.findUnique({
      where: { id: targetDesignationId },
    });
    if (!designation) {
      details.push({ field: 'designationId', message: 'Selected designation does not exist.' });
    }
  }

  if (details.length > 0) {
    throw ApiError.validationError(details);
  }

  const slug =
    cleanTitle.toLowerCase() === current.title.toLowerCase()
      ? current.slug
      : await uniqueSlug(prisma.project, cleanTitle, id);

  if (isDefault) {
    await prisma.project.updateMany({
      where: { domainId: targetDomainId, id: { not: id }, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      title: cleanTitle,
      slug,
      domainId: targetDomainId,
      designationId: targetDesignationId || null,
      starterRepoUrl:
        starterRepoUrl !== undefined ? starterRepoUrl?.trim() || '' : current.starterRepoUrl,
      appStarterRepoUrl:
        appStarterRepoUrl !== undefined
          ? appStarterRepoUrl?.trim() || ''
          : current.appStarterRepoUrl,
      description: description !== undefined ? description?.trim() || '' : current.description,
      technologies: Array.isArray(technologies) ? technologies : current.technologies,
      webTechStack: Array.isArray(webTechStack) ? webTechStack : current.webTechStack,
      webDeliverables:
        webDeliverables !== undefined ? webDeliverables?.trim() || '' : current.webDeliverables,
      appTechStack: Array.isArray(appTechStack) ? appTechStack : current.appTechStack,
      appDeliverables:
        appDeliverables !== undefined ? appDeliverables?.trim() || '' : current.appDeliverables,
      durationsSupported:
        Array.isArray(durationsSupported) && durationsSupported.length > 0
          ? durationsSupported
          : current.durationsSupported,
      isDefault: isDefault !== undefined ? Boolean(isDefault) : current.isDefault,
      status: status !== undefined ? status : current.status,
      updatedBy: req.user.id,
    },
    include: {
      domain: true,
      designation: true,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'PROJECT_UPDATED',
    entityType: 'Project',
    entityId: updated.id,
    before: projectDto(current),
    after: projectDto(updated),
    ip: req.ip,
  });

  ok(res, projectDto(updated));
});

/**
 * PATCH /api/v1/admin/projects/:id/status
 */
const updateProjectStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (![PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED].includes(status)) {
    throw ApiError.validationError([
      { field: 'status', message: 'Status must be DRAFT or PUBLISHED.' },
    ]);
  }

  const current = await prisma.project.findUnique({ where: { id } });
  if (!current) {
    throw ApiError.notFound('Project not found.');
  }

  const updated = await prisma.project.update({
    where: { id },
    data: { status, updatedBy: req.user.id },
    include: { domain: true, designation: true },
  });

  await addAudit({
    actorId: req.user.id,
    action: `PROJECT_${status === PUBLISH_STATUS.PUBLISHED ? 'PUBLISHED' : 'UNPUBLISHED'}`,
    entityType: 'Project',
    entityId: updated.id,
    before: { status: current.status },
    after: { status: updated.status },
    ip: req.ip,
  });

  ok(res, projectDto(updated));
});

/**
 * DELETE /api/v1/admin/projects/:id
 */
const deleteProject = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const current = await prisma.project.findUnique({ where: { id } });
  if (!current) {
    throw ApiError.notFound('Project not found.');
  }

  // Unlink from any active enrollments before deletion
  await prisma.enrollment.updateMany({
    where: { projectId: id },
    data: { projectId: null, projectAssignedAt: null },
  });

  await prisma.project.delete({ where: { id } });

  await addAudit({
    actorId: req.user.id,
    action: 'PROJECT_DELETED',
    entityType: 'Project',
    entityId: id,
    before: projectDto(current),
    ip: req.ip,
  });

  ok(res, { success: true, message: 'Project deleted successfully.' });
});

// ─── Project Assignments ─────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/project-assignments
 */
const listProjectAssignments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 20);
  const { domainId, track, status, search } = req.query;

  // Build where condition for enrollments
  const where = {
    status: { not: 'CANCELLED' },
    ...(track && { track: String(track) }),
    ...(domainId && {
      plan: {
        domainId: String(domainId),
      },
    }),
    ...(status === 'ASSIGNED' && { projectId: { not: null } }),
    ...(status === 'UNASSIGNED' && { projectId: null }),
    ...(search && {
      user: {
        OR: [
          { name: { contains: String(search), mode: 'insensitive' } },
          { email: { contains: String(search), mode: 'insensitive' } },
        ],
      },
    }),
  };

  const [total, enrollments] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      include: {
        user: true,
        plan: {
          include: {
            domain: true,
            designation: true,
          },
        },
        project: {
          include: {
            domain: true,
            designation: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(enrollments.map(assignmentDto), total, page, limit));
});

/**
 * POST /api/v1/admin/project-assignments
 */
const assignProject = asyncHandler(async (req, res) => {
  const { enrollmentId, projectId, track } = req.body;

  if (!enrollmentId) {
    throw ApiError.validationError([{ field: 'enrollmentId', message: 'Enrollment ID is required.' }]);
  }
  if (!projectId) {
    throw ApiError.validationError([{ field: 'projectId', message: 'Project ID is required.' }]);
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: true,
      plan: { include: { domain: true, designation: true } },
    },
  });

  if (!enrollment) {
    throw ApiError.notFound('Enrollment not found.');
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { domain: true, designation: true },
  });

  if (!project) {
    throw ApiError.notFound('Project not found.');
  }

  const updatedEnrollment = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      projectId: project.id,
      projectAssignedAt: new Date(),
      track: track || enrollment.track || 'web',
    },
    include: {
      user: true,
      plan: { include: { domain: true, designation: true } },
      project: { include: { domain: true, designation: true } },
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'PROJECT_ASSIGNED',
    entityType: 'Enrollment',
    entityId: enrollmentId,
    after: {
      projectId: project.id,
      projectTitle: project.title,
      studentId: enrollment.userId,
      track: updatedEnrollment.track,
    },
    ip: req.ip,
  });

  ok(res, assignmentDto(updatedEnrollment));
});

/**
 * DELETE /api/v1/admin/project-assignments/:enrollmentId
 */
const unassignProject = asyncHandler(async (req, res) => {
  const { enrollmentId } = req.params;

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: true,
      plan: { include: { domain: true, designation: true } },
      project: { include: { domain: true, designation: true } },
    },
  });

  if (!enrollment) {
    throw ApiError.notFound('Enrollment not found.');
  }

  const updatedEnrollment = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      projectId: null,
      projectAssignedAt: null,
    },
    include: {
      user: true,
      plan: { include: { domain: true, designation: true } },
      project: { include: { domain: true, designation: true } },
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'PROJECT_UNASSIGNED',
    entityType: 'Enrollment',
    entityId: enrollmentId,
    before: {
      projectId: enrollment.projectId,
      studentId: enrollment.userId,
    },
    ip: req.ip,
  });

  ok(res, assignmentDto(updatedEnrollment));
});

// ─── Public / Student Projects ───────────────────────────────────────────────

/**
 * GET /api/v1/domains/:domainId/projects
 */
const getDomainProjects = asyncHandler(async (req, res) => {
  const { domainId } = req.params;

  // Resolve domain by id or slug
  const domain = await prisma.domain.findFirst({
    where: {
      OR: [{ id: domainId }, { slug: domainId }],
    },
  });

  if (!domain) {
    return ok(res, { items: [], total: 0 });
  }

  const projects = await prisma.project.findMany({
    where: {
      domainId: domain.id,
      status: PUBLISH_STATUS.PUBLISHED,
    },
    include: {
      domain: true,
      designation: true,
    },
    orderBy: [{ isDefault: 'desc' }, { title: 'asc' }],
  });

  ok(res, {
    items: projects.map(projectDto),
    total: projects.length,
  });
});

module.exports = {
  projectDto,
  assignmentDto,
  listAdminProjects,
  getAdminProject,
  createProject,
  updateProject,
  updateProjectStatus,
  deleteProject,
  listProjectAssignments,
  assignProject,
  unassignProject,
  getDomainProjects,
};
