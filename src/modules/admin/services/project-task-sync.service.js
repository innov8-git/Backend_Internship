'use strict';

const { prisma } = require('../../../database');
const { SCHEDULE_STATUS, TASK_STATUS, ENROLLMENT_STATUS } = require('../../../common/constants');

function normalizeTrack(track) {
  return String(track || 'web').toLowerCase() === 'app' ? 'app' : 'web';
}

function getStarterRepoForTrack(project, track) {
  if (!project) return null;
  if (track === 'app') {
    return project.appStarterRepoUrl || project.starterRepoUrl || null;
  }
  return project.starterRepoUrl || null;
}

/**
 * Generates clean structured milestone tasks when an admin assigns a project
 * that has not yet had custom taskTemplates configured for that track & duration.
 */
function buildDefaultProjectTasks(project, durationMonths, track) {
  const isApp = track === 'app';
  const trackLabel = isApp ? 'Mobile App' : 'Web Application';
  const title = project.title || 'Capstone Project';
  const domainName = project.domain?.name || 'Industry';
  const stack = isApp
    ? Array.isArray(project.appTechStack) && project.appTechStack.length > 0
      ? project.appTechStack
      : ['React Native / Flutter', 'REST APIs', 'Git']
    : Array.isArray(project.webTechStack) && project.webTechStack.length > 0
      ? project.webTechStack
      : Array.isArray(project.technologies) && project.technologies.length > 0
        ? project.technologies
        : ['React', 'Node.js', 'PostgreSQL', 'Git'];
  const deliverables = (isApp ? project.appDeliverables : project.webDeliverables) || project.description || '';
  const totalWorkingDays =
    durationMonths === 1 ? 20 : durationMonths === 2 ? 40 : durationMonths === 3 ? 60 : durationMonths === 4 ? 80 : 120;

  const milestones = [
    {
      dayNumber: 1,
      title: `${title}: Repository Setup & Architecture Plan`,
      problemStatement: `Initialize the ${trackLabel} repository for ${title} (${domainName} domain) using ${stack.join(', ')}. Document the folder structure, architecture diagram, and local setup instructions.`,
      expectedOutcome: 'Clean starter repository setup with README, architecture notes, and verified local build.',
      acceptanceCriteria: [
        'Repository initialized with clean branch structure',
        'Local build runs with zero errors',
        'Architecture and setup documentation committed',
      ],
      estimatedHours: 4,
      requiresTrainerReview: true,
    },
    {
      dayNumber: Math.max(2, Math.round(totalWorkingDays * 0.25)),
      title: `${title}: Core Domain Models & Authentication`,
      problemStatement: `Implement core ${domainName} domain schemas, data validation, and user authentication flows for the ${trackLabel}.`,
      expectedOutcome: 'Working domain models, validation rules, and end-to-end authenticated user session flow.',
      acceptanceCriteria: [
        'Domain data models and seed/sample records working',
        'Authentication & protected routes verified',
        'Screenshots and GitHub commit/PR link provided',
      ],
      estimatedHours: 8,
      requiresTrainerReview: true,
    },
    {
      dayNumber: Math.max(3, Math.round(totalWorkingDays * 0.5)),
      title: `${title}: Primary Feature Workflows & UI/API Integration`,
      problemStatement: `Build the core user-facing workflows and API integrations for ${title}.${deliverables ? ` Target deliverables: ${deliverables}` : ''}`,
      expectedOutcome: 'Core business workflows functional end-to-end with error handling and responsive states.',
      acceptanceCriteria: [
        'Primary CRUD / workflow journeys functioning cleanly',
        'Error, loading, and empty states handled',
        'Code cleanly committed to GitHub',
      ],
      estimatedHours: 12,
      requiresTrainerReview: true,
    },
    {
      dayNumber: Math.max(4, Math.round(totalWorkingDays * 0.75)),
      title: `${title}: Security, Edge Cases & Performance Hardening`,
      problemStatement: `Audit ${title} for access control, input validation, edge cases, and performance across the ${trackLabel} stack.`,
      expectedOutcome: 'Hardened application with verified edge-case handling and automated checks.',
      acceptanceCriteria: [
        'Role/permission checks and validation enforced',
        'Unit/integration tests covering key logic',
        'Zero console or server errors on primary flows',
      ],
      estimatedHours: 10,
      requiresTrainerReview: true,
    },
    {
      dayNumber: totalWorkingDays,
      title: `${title}: Final Integration, Testing & Production Demo`,
      problemStatement: `Complete final end-to-end QA, polish documentation, and prepare the final submission for ${title} (${durationMonths}-month ${domainName} internship).`,
      expectedOutcome: 'Production-ready repository, passing test suite, and complete walkthrough screenshots/demo.',
      acceptanceCriteria: [
        'All acceptance deliverables complete and verified',
        'Automated tests pass cleanly',
        'Final README and demo evidence published on GitHub',
      ],
      estimatedHours: 12,
      requiresTrainerReview: true,
    },
  ];

  return milestones.map((m, idx) => ({ ...m, sequence: idx + 1 }));
}

/**
 * Extract configured tasks from project.taskTemplates[track][durationMonths].
 * Filters out empty placeholder boxes created by ProjectTasksModal.
 */
function extractProjectTasks(project, durationMonths, track) {
  const templates = project?.taskTemplates;
  let rawSet = null;
  if (templates && typeof templates === 'object') {
    const byTrack = templates[track];
    if (byTrack && typeof byTrack === 'object') {
      rawSet = byTrack[String(durationMonths)] || byTrack[durationMonths] || null;
    }
  }

  if (Array.isArray(rawSet)) {
    const configured = rawSet
      .filter((slot) => slot && typeof slot.title === 'string' && slot.title.trim().length > 0)
      .sort((a, b) => (Number(a.dayNumber) || Number(a.sequence) || 0) - (Number(b.dayNumber) || Number(b.sequence) || 0));

    if (configured.length > 0) {
      return configured.map((slot, index) => ({
        dayNumber: Number(slot.dayNumber) || index + 1,
        sequence: index + 1,
        title: slot.title.trim(),
        problemStatement: String(slot.problemStatement || '').trim(),
        expectedOutcome: String(slot.expectedOutcome || '').trim(),
        acceptanceCriteria: Array.isArray(slot.acceptanceCriteria)
          ? slot.acceptanceCriteria.map((c) => String(c || '').trim()).filter(Boolean)
          : [],
        estimatedHours: Number(slot.estimatedHours) > 0 ? Number(slot.estimatedHours) : 4,
        requiresTrainerReview: slot.requiresTrainerReview !== false,
      }));
    }
  }

  return buildDefaultProjectTasks(project, durationMonths, track);
}

function buildScheduleDaysFromTasks(project, tasks, track) {
  const trackLabel = track === 'app' ? 'Mobile App Development' : 'Web Development';
  return tasks.map((task) => {
    const criteriaLines =
      task.acceptanceCriteria.length > 0
        ? task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')
        : '- Clean code committed to your GitHub repository.';

    const sopContent = [
      `## ${task.title}`,
      '',
      `**Project:** ${project.title} (${trackLabel})`,
      '',
      '## Problem Statement',
      '',
      task.problemStatement || 'Complete the assigned project milestone requirements.',
      '',
      '## Expected Outcome',
      '',
      task.expectedOutcome || 'Working deliverable verified locally and pushed to GitHub.',
      '',
      '## Acceptance Criteria',
      '',
      criteriaLines,
    ].join('\n');

    return {
      dayNumber: task.dayNumber,
      title: task.title,
      activity: task.problemStatement || `Complete Day ${task.dayNumber} deliverable for ${project.title}.`,
      requiredEvidence: task.expectedOutcome || 'GitHub commit/PR link and verification screenshots.',
      sopContent,
    };
  });
}

/**
 * Ensures a published ScheduleTemplate + sequential TaskDefinitions exist and stay up to date
 * for (project, designationId, domainId, track, durationMonths).
 * Updates existing TaskDefinitions in place (by dayNumber/sequence) so TaskProgress FKs stay intact.
 */
async function ensureProjectScheduleTemplate({
  project,
  designationId,
  domainId,
  durationMonths,
  track,
  actorId,
}) {
  const normalizedTrack = normalizeTrack(track);
  const tasks = extractProjectTasks(project, durationMonths, normalizedTrack);
  const days = buildScheduleDaysFromTasks(project, tasks, normalizedTrack);
  const starterRepoUrl = getStarterRepoForTrack(project, normalizedTrack);

  let template = await prisma.scheduleTemplate.findFirst({
    where: {
      projectId: project.id,
      designationId,
      domainId,
      track: normalizedTrack,
      durationMonths,
    },
    include: {
      taskDefinitions: { orderBy: { sequence: 'asc' } },
    },
    orderBy: { version: 'desc' },
  });

  if (!template) {
    const highest = await prisma.scheduleTemplate.findFirst({
      where: { designationId, domainId, durationMonths },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (highest?.version || 0) + 1;

    template = await prisma.scheduleTemplate.create({
      data: {
        designationId,
        domainId,
        projectId: project.id,
        track: normalizedTrack,
        durationMonths,
        version: nextVersion,
        status: SCHEDULE_STATUS.PUBLISHED,
        days,
        publishedAt: new Date(),
        createdBy: actorId || null,
      },
      include: { taskDefinitions: true },
    });
  } else {
    template = await prisma.scheduleTemplate.update({
      where: { id: template.id },
      data: {
        days,
        status: SCHEDULE_STATUS.PUBLISHED,
        publishedAt: template.publishedAt || new Date(),
      },
      include: {
        taskDefinitions: { orderBy: { sequence: 'asc' } },
      },
    });
  }

  // Reconcile TaskDefinitions in place by dayNumber (or sequence fallback)
  const existingByDay = new Map();
  const existingBySeq = new Map();
  for (const def of template.taskDefinitions || []) {
    if (def.dayNumber) existingByDay.set(def.dayNumber, def);
    existingBySeq.set(def.sequence, def);
  }

  const syncedDefs = [];
  let prevTaskId = null;

  for (const task of tasks) {
    const prereqIds = prevTaskId ? [prevTaskId] : [];
    const matched = existingByDay.get(task.dayNumber) || existingBySeq.get(task.sequence);

    let saved;
    if (matched) {
      saved = await prisma.taskDefinition.update({
        where: { id: matched.id },
        data: {
          sequence: task.sequence,
          dayNumber: task.dayNumber,
          title: task.title,
          problemStatement: task.problemStatement,
          expectedOutcome: task.expectedOutcome,
          acceptanceCriteria: task.acceptanceCriteria,
          starterRepoUrl,
          estimatedHours: task.estimatedHours,
          requiresTrainerReview: true,
          prerequisiteTaskIds: prereqIds,
        },
      });
    } else {
      saved = await prisma.taskDefinition.create({
        data: {
          templateId: template.id,
          templateVersion: template.version,
          sequence: task.sequence,
          dayNumber: task.dayNumber,
          title: task.title,
          problemStatement: task.problemStatement,
          expectedOutcome: task.expectedOutcome,
          acceptanceCriteria: task.acceptanceCriteria,
          starterRepoUrl,
          estimatedHours: task.estimatedHours,
          requiresTrainerReview: true,
          prerequisiteTaskIds: prereqIds,
          createdBy: actorId || null,
        },
      });
    }

    syncedDefs.push(saved);
    prevTaskId = saved.id;
  }

  return { template, taskDefinitions: syncedDefs };
}

/**
 * Syncs a project's tasks & schedule onto a student (or team) enrollment.
 * Safely preserves any TaskProgress rows that already have submissions or active progress,
 * while removing untouched LOCKED/AVAILABLE rows from superseded templates.
 */
async function syncProjectTasksToEnrollment(enrollmentId, project, { actorId = null, track = null } = {}) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      plan: { include: { designation: true, domain: true } },
    },
  });
  if (!enrollment || !enrollment.plan || !project) {
    return { template: null, taskCount: 0 };
  }

  const resolvedTrack = normalizeTrack(track || enrollment.track);
  const durationMonths = enrollment.plan.durationMonths || 2;

  const { template, taskDefinitions } = await ensureProjectScheduleTemplate({
    project,
    designationId: enrollment.plan.designationId,
    domainId: enrollment.plan.domainId,
    durationMonths,
    track: resolvedTrack,
    actorId,
  });

  // Link template (and project/track for team peers) on the enrollment(s)
  if (enrollment.teamId) {
    await prisma.enrollment.updateMany({
      where: {
        teamId: enrollment.teamId,
        status: { not: ENROLLMENT_STATUS.CANCELLED },
      },
      data: {
        projectId: project.id,
        projectAssignedAt: enrollment.projectAssignedAt || new Date(),
        track: resolvedTrack,
        scheduleTemplateId: template.id,
        scheduleVersion: template.version,
      },
    });
  } else {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        scheduleTemplateId: template.id,
        scheduleVersion: template.version,
        track: resolvedTrack,
      },
    });
  }

  const scopeWhere = enrollment.teamId
    ? { teamId: enrollment.teamId }
    : { enrollmentId: enrollment.id };

  const existingProgress = await prisma.taskProgress.findMany({
    where: scopeWhere,
    include: {
      _count: { select: { submissions: true } },
    },
  });

  const targetTaskIds = new Set(taskDefinitions.map((t) => t.id));

  // Remove untouched progress rows belonging to a different/old template
  const removableIds = existingProgress
    .filter(
      (p) =>
        !targetTaskIds.has(p.taskId) &&
        p._count.submissions === 0 &&
        [TASK_STATUS.LOCKED, TASK_STATUS.AVAILABLE].includes(p.status),
    )
    .map((p) => p.id);

  if (removableIds.length > 0) {
    await prisma.taskProgress.deleteMany({
      where: { id: { in: removableIds } },
    });
  }

  const remainingProgress = existingProgress.filter((p) => !removableIds.includes(p.id));
  const byTaskId = new Map(remainingProgress.map((p) => [p.taskId, p]));
  const approvedTaskIds = new Set(
    remainingProgress.filter((p) => p.status === TASK_STATUS.APPROVED).map((p) => p.taskId),
  );

  for (const def of taskDefinitions) {
    const prereqs = Array.isArray(def.prerequisiteTaskIds) ? def.prerequisiteTaskIds : [];
    const prereqsSatisfied = prereqs.length === 0 || prereqs.every((pid) => approvedTaskIds.has(pid));
    const existing = byTaskId.get(def.id);

    if (!existing) {
      await prisma.taskProgress.create({
        data: {
          enrollmentId: enrollment.id,
          teamId: enrollment.teamId || null,
          taskId: def.id,
          status: prereqsSatisfied ? TASK_STATUS.AVAILABLE : TASK_STATUS.LOCKED,
        },
      });
    } else if (existing.status === TASK_STATUS.LOCKED && prereqsSatisfied) {
      await prisma.taskProgress.update({
        where: { id: existing.id },
        data: { status: TASK_STATUS.AVAILABLE },
      });
    }
  }

  return { template, taskCount: taskDefinitions.length };
}

/**
 * When Admin updates a Project's taskTemplates, safely propagate changes to all
 * active/in-progress enrollments currently assigned to that project.
 */
async function syncProjectTasksToAssignedEnrollments(projectId, actorId = null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { domain: true, designation: true },
  });
  if (!project) return { syncedEnrollments: 0 };

  const assignedEnrollments = await prisma.enrollment.findMany({
    where: {
      projectId,
      status: {
        in: [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.IN_PROGRESS, ENROLLMENT_STATUS.PENDING_PAYMENT],
      },
    },
    select: { id: true, teamId: true, track: true },
  });

  // Deduplicate by teamId so team enrollments are synced once per team
  const seenTeams = new Set();
  let synced = 0;
  for (const e of assignedEnrollments) {
    if (e.teamId) {
      if (seenTeams.has(e.teamId)) continue;
      seenTeams.add(e.teamId);
    }
    await syncProjectTasksToEnrollment(e.id, project, { actorId, track: e.track });
    synced += 1;
  }

  return { syncedEnrollments: synced };
}

module.exports = {
  normalizeTrack,
  extractProjectTasks,
  ensureProjectScheduleTemplate,
  syncProjectTasksToEnrollment,
  syncProjectTasksToAssignedEnrollments,
};
