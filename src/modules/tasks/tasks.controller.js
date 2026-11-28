'use strict';

const multer = require('multer');
const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const {
  ROLES,
  ENROLLMENT_STATUS,
  TASK_STATUS,
  REVIEW_STATUS,
  MEMBER_STATUS,
} = require('../../common/constants');
const { getStorage } = require('../../libs/storage');
const { sendTaskSubmittedEmail } = require('../../libs/email');
const {
  createNotification,
  notifyAdmins,
} = require('../notifications/services/notifications.service');
const { syncProjectTasksToEnrollment } = require('../admin/services/project-task-sync.service');
const logger = require('../../libs/logger');

const SUBMISSION_RULES = {
  minScreenshots: 1,
  maxScreenshots: 5,
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  minDescriptionLength: 50,
  maxDescriptionLength: 5000,
  githubUrlPrefix: 'https://github.com/',
};

// Multer in-memory storage for handling upload validation before sending to storage service
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: SUBMISSION_RULES.maxFileSizeBytes,
    files: SUBMISSION_RULES.maxScreenshots,
  },
});

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function progressDto(progress, taskDef = null, scopeProgressList = null) {
  if (!progress) return null;
  const task = taskDef || progress.task;
  const prereqIds = parseJsonArray(task?.prerequisiteTaskIds);

  let prerequisites = [];
  if (prereqIds.length > 0 && Array.isArray(scopeProgressList)) {
    const byTaskId = new Map(scopeProgressList.map((p) => [p.taskId, p]));
    prerequisites = prereqIds.map((taskId) => {
      const match = byTaskId.get(taskId);
      return {
        taskId,
        progressId: match?.id || null,
        title: match?.task?.title || 'Prerequisite task',
        status: match?.status || TASK_STATUS.LOCKED,
      };
    });
  }

  return {
    _id: progress.id,
    enrollmentId: progress.enrollmentId,
    teamId: progress.teamId || null,
    taskId: progress.taskId,
    status: progress.status,
    startedAt: progress.startedAt || null,
    submittedAt: progress.submittedAt || null,
    approvedAt: progress.approvedAt || null,
    attempts: progress.attempts || 0,
    lastReviewStatus: progress.lastReviewStatus || null,
    prerequisites,
    task: task
      ? {
          _id: task.id,
          title: task.title,
          sequence: task.sequence,
          dayNumber: task.dayNumber || null,
          estimatedHours: task.estimatedHours || null,
          requiresTrainerReview: task.requiresTrainerReview,
        }
      : null,
  };
}

function submissionDto(sub) {
  if (!sub) return null;
  return {
    _id: sub.id,
    taskProgressId: sub.taskProgressId,
    enrollmentId: sub.enrollmentId,
    attemptNumber: sub.attemptNumber,
    description: sub.description,
    githubUrl: sub.githubUrl,
    screenshots: parseJsonArray(sub.screenshots),
    submittedBy: sub.submittedBy
      ? { _id: sub.submittedBy.id, name: sub.submittedBy.name }
      : null,
    reviewStatus: sub.reviewStatus,
    submittedAt: sub.submittedAt,
    review: sub.review
      ? {
          _id: sub.review.id,
          decision: sub.review.decision,
          feedback: sub.review.feedback,
          reviewedAt: sub.review.reviewedAt,
          trainer: sub.review.trainer
            ? { _id: sub.review.trainer.id, name: sub.review.trainer.name }
            : null,
        }
      : null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function canAccessProgress(user, progress) {
  if (user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.TRAINER)) return true;

  if (progress.teamId) {
    const isMember = await prisma.teamMember.findFirst({
      where: {
        teamId: progress.teamId,
        userId: user.id,
        status: MEMBER_STATUS.JOINED,
      },
    });
    if (isMember) return true;
  }

  if (progress.enrollmentId) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: progress.enrollmentId },
    });
    if (enrollment && enrollment.userId === user.id) return true;
  }

  return false;
}

async function loadUnlockedProgress(user, progressId) {
  const progress = await prisma.taskProgress.findUnique({
    where: { id: progressId },
    include: {
      task: true,
      enrollment: {
        include: {
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
          team: true,
        },
      },
    },
  });

  if (!progress) throw ApiError.notFound('Task progress not found.');

  const hasAccess = await canAccessProgress(user, progress);
  if (!hasAccess) throw ApiError.forbidden('FORBIDDEN', "You don't have access to this task.");

  // For team tasks viewed by a student, check the student's own enrollment if present
  let enrollment = progress.enrollment;
  if (progress.teamId && !user.roles.includes(ROLES.ADMIN) && !user.roles.includes(ROLES.TRAINER)) {
    const ownEnrollment = await prisma.enrollment.findFirst({
      where: {
        teamId: progress.teamId,
        userId: user.id,
        status: { not: ENROLLMENT_STATUS.CANCELLED },
      },
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        team: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (ownEnrollment) {
      enrollment = ownEnrollment;
    }
  }

  if (
    !enrollment ||
    ![ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.IN_PROGRESS, ENROLLMENT_STATUS.COMPLETED].includes(
      enrollment.status,
    )
  ) {
    throw ApiError.forbidden(
      'ENROLLMENT_NOT_ACTIVE',
      'Your enrollment is not active yet. Complete your payment to unlock your tasks.',
    );
  }

  return { progress, enrollment };
}

async function markEnrollmentInProgress(progress, enrollment) {
  if (progress.teamId) {
    await prisma.enrollment.updateMany({
      where: {
        teamId: progress.teamId,
        status: ENROLLMENT_STATUS.ACTIVE,
      },
      data: { status: ENROLLMENT_STATUS.IN_PROGRESS },
    });
  } else if (enrollment && enrollment.status === ENROLLMENT_STATUS.ACTIVE) {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: ENROLLMENT_STATUS.IN_PROGRESS },
    });
  }
}

async function findActiveTrainerForProgress(progress, enrollment) {
  const conditions = [];
  if (progress.teamId) {
    conditions.push({ teamId: progress.teamId, active: true });
  }
  const enrollmentId = progress.enrollmentId || enrollment?.id;
  if (enrollmentId) {
    conditions.push({ enrollmentId, active: true });
  }
  if (conditions.length === 0) return null;

  const assignment = await prisma.trainerAssignment.findFirst({
    where: { OR: conditions },
    include: {
      trainer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { assignedAt: 'desc' },
  });

  return assignment?.trainer || null;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * GET /enrollments/:id/tasks
 */
const listEnrollmentTasks = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page, limit, skip } = parsePagination(req.query, 100);

  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    include: {
      project: true,
      team: { include: { members: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found.');

  const isOwner = enrollment.userId === req.user.id;
  const isMember = enrollment.team?.members.some(
    (m) => m.userId === req.user.id && m.status === MEMBER_STATUS.JOINED,
  );
  if (!isOwner && !isMember && !req.user.roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', 'Access denied.');
  }

  if (
    ![ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.IN_PROGRESS, ENROLLMENT_STATUS.COMPLETED].includes(
      enrollment.status,
    )
  ) {
    throw ApiError.forbidden(
      'ENROLLMENT_NOT_ACTIVE',
      'Your enrollment is not active yet. Complete your payment to unlock your tasks.',
    );
  }

  const where = enrollment.teamId
    ? { teamId: enrollment.teamId }
    : { enrollmentId: enrollment.id };

  let allScopeItems = await prisma.taskProgress.findMany({
    where,
    include: { task: true },
    orderBy: { task: { sequence: 'asc' } },
  });

  // Backfill tasks automatically if an active enrollment already has a project assigned but 0 TaskProgress rows
  if (allScopeItems.length === 0 && enrollment.projectId && enrollment.project) {
    try {
      await syncProjectTasksToEnrollment(enrollment.id, enrollment.project, {
        actorId: req.user.id,
        track: enrollment.track,
      });
      allScopeItems = await prisma.taskProgress.findMany({
        where,
        include: { task: true },
        orderBy: { task: { sequence: 'asc' } },
      });
    } catch (err) {
      logger.warn(`[Tasks] Lazy task sync failed for enrollment ${enrollment.id}: ${err.message}`);
    }
  }

  const total = allScopeItems.length;
  const paged = allScopeItems.slice(skip, skip + limit);

  ok(
    res,
    paginatedResponse(
      paged.map((p) => progressDto(p, p.task, allScopeItems)),
      total,
      page,
      limit,
    ),
  );
});

/**
 * GET /tasks/:id/content
 */
const getTaskContent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { progress, enrollment } = await loadUnlockedProgress(req.user, id);

  const definition = progress.task;
  if (!definition) throw ApiError.notFound('Task definition not found.');

  const scopeWhere = progress.teamId
    ? { teamId: progress.teamId }
    : { enrollmentId: progress.enrollmentId };

  const scopeProgressList = await prisma.taskProgress.findMany({
    where: scopeWhere,
    include: { task: true },
  });

  const locked = progress.status === TASK_STATUS.LOCKED;

  const task = {
    _id: definition.id,
    title: definition.title,
    sequence: definition.sequence,
    dayNumber: definition.dayNumber || null,
    estimatedHours: definition.estimatedHours || null,
    requiresTrainerReview: definition.requiresTrainerReview,
  };

  if (!locked) {
    task.problemStatement = definition.problemStatement || '';
    task.expectedOutcome = definition.expectedOutcome || '';
    task.acceptanceCriteria = parseJsonArray(definition.acceptanceCriteria);
    task.starterRepoUrl = definition.starterRepoUrl || null;
  }

  const team = enrollment.team
    ? { _id: enrollment.team.id, name: enrollment.team.name, repoUrl: enrollment.team.repoUrl || null }
    : null;

  ok(res, {
    locked,
    progress: progressDto(progress, definition, scopeProgressList),
    task,
    enrollment: {
      _id: enrollment.id,
      enrollmentType: enrollment.enrollmentType,
      teamId: enrollment.teamId || null,
    },
    team,
  });
});

/**
 * POST /tasks/:id/start
 */
const startTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { progress, enrollment } = await loadUnlockedProgress(req.user, id);

  if (progress.status === TASK_STATUS.LOCKED) {
    throw ApiError.forbidden(
      'TASK_LOCKED',
      'Complete the prerequisite tasks to unlock this one.',
    );
  }

  if (progress.status !== TASK_STATUS.AVAILABLE) {
    throw ApiError.conflict('INVALID_TRANSITION', 'This task has already been started.');
  }

  const updated = await prisma.taskProgress.update({
    where: { id },
    data: {
      status: TASK_STATUS.IN_PROGRESS,
      startedAt: new Date(),
    },
    include: { task: true },
  });

  await markEnrollmentInProgress(updated, enrollment);

  ok(res, progressDto(updated));
});

/**
 * POST /tasks/:id/submissions
 */
const submitTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { progress, enrollment } = await loadUnlockedProgress(req.user, id);

  if (progress.status === TASK_STATUS.LOCKED) {
    throw ApiError.forbidden(
      'TASK_LOCKED',
      'Complete the prerequisite tasks to unlock this one.',
    );
  }

  const submittable = [TASK_STATUS.IN_PROGRESS, TASK_STATUS.CHANGES_REQUESTED];
  if (!submittable.includes(progress.status)) {
    throw ApiError.conflict(
      'INVALID_TRANSITION',
      progress.status === TASK_STATUS.SUBMITTED
        ? 'This task is already waiting for review.'
        : 'This task can no longer be submitted.',
    );
  }

  const files = req.files || [];
  const description = String(req.body.description || '').trim();
  const githubUrl = String(req.body.githubUrl || '').trim();

  const details = [];
  if (files.length < SUBMISSION_RULES.minScreenshots) {
    details.push({ field: 'screenshots', message: 'Add at least one screenshot of your work.' });
  } else if (files.length > SUBMISSION_RULES.maxScreenshots) {
    details.push({
      field: 'screenshots',
      message: `You can attach up to ${SUBMISSION_RULES.maxScreenshots} screenshots.`,
    });
  } else {
    files.forEach((f, idx) => {
      if (!SUBMISSION_RULES.allowedMimeTypes.includes(f.mimetype)) {
        details.push({
          field: 'screenshots',
          message: `Screenshot ${idx + 1} must be a PNG, JPG or WebP image.`,
        });
      }
      if (f.size > SUBMISSION_RULES.maxFileSizeBytes) {
        details.push({
          field: 'screenshots',
          message: `Screenshot ${idx + 1} is larger than 5 MB.`,
        });
      }
    });
  }

  if (description.length < SUBMISSION_RULES.minDescriptionLength) {
    details.push({
      field: 'description',
      message: `Describe your work in at least ${SUBMISSION_RULES.minDescriptionLength} characters.`,
    });
  } else if (description.length > SUBMISSION_RULES.maxDescriptionLength) {
    details.push({
      field: 'description',
      message: `Keep the description under ${SUBMISSION_RULES.maxDescriptionLength} characters.`,
    });
  }

  if (!githubUrl.startsWith(SUBMISSION_RULES.githubUrlPrefix)) {
    details.push({
      field: 'githubUrl',
      message: `The link must start with ${SUBMISSION_RULES.githubUrlPrefix}`,
    });
  }

  if (details.length > 0) throw ApiError.validationError(details);

  // Upload files to storage service
  const storage = getStorage();
  const screenshots = [];
  for (const file of files) {
    const uploaded = await storage.upload(file.buffer, file.originalname, file.mimetype);
    screenshots.push(uploaded);
  }

  const attemptNumber = (progress.attempts || 0) + 1;
  const now = new Date();

  const [submission] = await prisma.$transaction([
    prisma.taskSubmission.create({
      data: {
        taskProgressId: progress.id,
        enrollmentId: progress.enrollmentId || enrollment.id,
        attemptNumber,
        description,
        githubUrl,
        screenshots,
        submittedById: req.user.id,
        reviewStatus: REVIEW_STATUS.PENDING,
      },
      include: {
        submittedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.taskProgress.update({
      where: { id: progress.id },
      data: {
        status: TASK_STATUS.SUBMITTED,
        submittedAt: now,
        attempts: attemptNumber,
        lastReviewStatus: REVIEW_STATUS.PENDING,
      },
    }),
  ]);

  await markEnrollmentInProgress(progress, enrollment);

  // Notify assigned trainer, or alert admins if no trainer is currently assigned
  const assignedTrainer = await findActiveTrainerForProgress(progress, enrollment);
  const taskTitle = progress.task?.title || 'Task';

  if (assignedTrainer) {
    await createNotification({
      userId: assignedTrainer.id,
      type: 'TASK_SUBMITTED',
      title: `New submission: ${taskTitle}`,
      message: `${req.user.name} submitted attempt #${attemptNumber} for review.`,
      link: `/trainer/review/${submission.id}`,
      metadata: {
        submissionId: submission.id,
        taskProgressId: progress.id,
        enrollmentId: progress.enrollmentId,
      },
    });

    if (assignedTrainer.email) {
      sendTaskSubmittedEmail({
        to: assignedTrainer.email,
        trainerName: assignedTrainer.name,
        studentName: req.user.name,
        taskTitle,
        submissionId: submission.id,
      }).catch((err) => logger.warn(`[Tasks] Failed to notify trainer via email: ${err.message}`));
    }
  } else {
    await notifyAdmins({
      type: 'UNASSIGNED_SUBMISSION',
      title: `Unassigned submission waiting: ${taskTitle}`,
      message: `${req.user.name} submitted attempt #${attemptNumber}, but no trainer is assigned to this enrollment yet.`,
      link: '/admin/submissions?unassigned=true',
      metadata: {
        submissionId: submission.id,
        enrollmentId: progress.enrollmentId,
        teamId: progress.teamId || null,
      },
    });
  }

  created(res, {
    ...submissionDto(submission),
    autoApproved: false,
    assignedTrainer: assignedTrainer ? { _id: assignedTrainer.id, name: assignedTrainer.name } : null,
  });
});

/**
 * GET /tasks/:id/submissions
 */
const listTaskSubmissions = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page, limit, skip } = parsePagination(req.query, 50);

  const { progress } = await loadUnlockedProgress(req.user, id);

  const [total, items] = await Promise.all([
    prisma.taskSubmission.count({ where: { taskProgressId: progress.id } }),
    prisma.taskSubmission.findMany({
      where: { taskProgressId: progress.id },
      include: {
        submittedBy: { select: { id: true, name: true } },
        review: {
          include: {
            trainer: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ attemptNumber: 'desc' }, { submittedAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(items.map(submissionDto), total, page, limit));
});

module.exports = {
  upload,
  listEnrollmentTasks,
  getTaskContent,
  startTask,
  submitTask,
  listTaskSubmissions,
};
