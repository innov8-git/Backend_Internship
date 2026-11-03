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
  PAYMENT_STATUS,
  TASK_STATUS,
  REVIEW_STATUS,
  MEMBER_STATUS,
} = require('../../common/constants');
const { getStorage } = require('../../libs/storage');

const SUBMISSION_RULES = {
  minScreenshots: 1,
  maxScreenshots: 5,
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  minDescriptionLength: 30,
  maxDescriptionLength: 2000,
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

function progressDto(progress, taskDef = null) {
  if (!progress) return null;
  const task = taskDef || progress.task;
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
    screenshots: Array.isArray(sub.screenshots) ? sub.screenshots : JSON.parse(sub.screenshots || '[]'),
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

  const enrollment = progress.enrollment;
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

  // Load task progress records
  const where = enrollment.teamId
    ? { teamId: enrollment.teamId }
    : { enrollmentId: enrollment.id };

  const [total, items] = await Promise.all([
    prisma.taskProgress.count({ where }),
    prisma.taskProgress.findMany({
      where,
      include: { task: true },
      orderBy: { task: { sequence: 'asc' } },
      skip,
      take: limit,
    }),
  ]);

  ok(res, paginatedResponse(items.map((p) => progressDto(p)), total, page, limit));
});

/**
 * GET /tasks/:id/content
 */
const getTaskContent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { progress, enrollment } = await loadUnlockedProgress(req.user, id);

  const definition = progress.task;
  if (!definition) throw ApiError.notFound('Task definition not found.');

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
    task.acceptanceCriteria = Array.isArray(definition.acceptanceCriteria)
      ? definition.acceptanceCriteria
      : JSON.parse(definition.acceptanceCriteria || '[]');
    task.starterRepoUrl = definition.starterRepoUrl || null;
  }

  const team = enrollment.team
    ? { _id: enrollment.team.id, name: enrollment.team.name, repoUrl: enrollment.team.repoUrl || null }
    : null;

  ok(res, {
    locked,
    progress: progressDto(progress, definition),
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
  const { progress } = await loadUnlockedProgress(req.user, id);

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

  // Create submission & update progress
  const [submission] = await prisma.$transaction([
    prisma.taskSubmission.create({
      data: {
        taskProgressId: progress.id,
        enrollmentId: enrollment.id,
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
        submittedAt: new Date(),
        attempts: attemptNumber,
        lastReviewStatus: REVIEW_STATUS.PENDING,
      },
    }),
  ]);

  created(res, submissionDto(submission));
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
