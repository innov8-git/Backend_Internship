const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const {
  ROLES,
  TASK_STATUS,
  REVIEW_STATUS,
  REVIEW_DECISION,
  CERTIFICATE_STATUS,
  EMAIL_STATUS,
  ENROLLMENT_STATUS,
} = require('../../common/constants');
const { sendCertificateIssuedEmail } = require('../../libs/email');
const logger = require('../../libs/logger');

const NOT_ASSIGNED_MESSAGE = "This submission isn't assigned to you.";
const MIN_FEEDBACK_LENGTH = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getTrainerActiveTargetIds(trainerId) {
  const assignments = await prisma.trainerAssignment.findMany({
    where: { trainerId, active: true },
  });

  const enrollmentIds = assignments.map((a) => a.enrollmentId).filter(Boolean);
  const teamIds = assignments.map((a) => a.teamId).filter(Boolean);

  return { enrollmentIds, teamIds, assignments };
}

async function trainerCanAccessSubmission(trainerId, submission) {
  const { enrollmentIds, teamIds } = await getTrainerActiveTargetIds(trainerId);

  if (submission.enrollmentId && enrollmentIds.includes(submission.enrollmentId)) {
    return true;
  }
  if (submission.taskProgress?.teamId && teamIds.includes(submission.taskProgress.teamId)) {
    return true;
  }
  return false;
}

async function nextCertificateNo() {
  const year = new Date().getFullYear();
  const prefix = `IP-${year}-`;

  const certs = await prisma.certificate.findMany({
    where: { certificateNo: { startsWith: prefix } },
    select: { certificateNo: true },
  });

  let highest = 0;
  certs.forEach((c) => {
    const num = parseInt(c.certificateNo.slice(prefix.length), 10);
    if (!Number.isNaN(num) && num > highest) highest = num;
  });

  return `${prefix}${String(highest + 1).padStart(6, '0')}`;
}

async function unlockDependents(enrollmentId, teamId) {
  const where = teamId ? { teamId } : { enrollmentId };

  const allProgress = await prisma.taskProgress.findMany({
    where,
    include: { task: true },
  });

  const approvedTaskIds = new Set(
    allProgress.filter((p) => p.status === TASK_STATUS.APPROVED).map((p) => p.taskId),
  );

  const lockedProgress = allProgress.filter((p) => p.status === TASK_STATUS.LOCKED);

  for (const p of lockedProgress) {
    let prereqs = [];
    if (p.task?.prerequisiteTaskIds) {
      prereqs = Array.isArray(p.task.prerequisiteTaskIds)
        ? p.task.prerequisiteTaskIds
        : JSON.parse(p.task.prerequisiteTaskIds || '[]');
    }

    const allPrereqsApproved = prereqs.length === 0 || prereqs.every((id) => approvedTaskIds.has(id));
    if (allPrereqsApproved) {
      await prisma.taskProgress.update({
        where: { id: p.id },
        data: { status: TASK_STATUS.AVAILABLE },
      });
    }
  }
}

async function checkCertificateEligibility(enrollmentId, teamId) {
  const where = teamId ? { teamId } : { enrollmentId };

  const allProgress = await prisma.taskProgress.findMany({
    where,
  });

  if (allProgress.length === 0 || !allProgress.every((p) => p.status === TASK_STATUS.APPROVED)) {
    return;
  }

  // Load target enrollments (all team members if team)
  const targetEnrollments = await prisma.enrollment.findMany({
    where: teamId ? { teamId } : { id: enrollmentId },
    include: { user: true, plan: { include: { designation: true } } },
  });

  for (const enrollment of targetEnrollments) {
    if (enrollment.status === ENROLLMENT_STATUS.COMPLETED) continue;

    // Check if certificate already exists
    const existing = await prisma.certificate.findUnique({
      where: { enrollmentId: enrollment.id },
    });
    if (existing) continue;

    const certNo = await nextCertificateNo();
    const certificate = await prisma.certificate.create({
      data: {
        certificateNo: certNo,
        userId: enrollment.userId,
        enrollmentId: enrollment.id,
        status: CERTIFICATE_STATUS.ISSUED,
        emailStatus: EMAIL_STATUS.SENT,
      },
    });

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: ENROLLMENT_STATUS.COMPLETED,
        completedAt: new Date(),
        certificateId: certificate.id,
      },
    });

    if (enrollment.user) {
      try {
        await sendCertificateIssuedEmail(
          enrollment.user.email,
          enrollment.user.name,
          certNo,
          enrollment.plan?.designation?.name || 'Internship',
        );
      } catch (err) {
        logger.warn('Failed to send certificate email:', err.message);
      }
    }
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const getTrainerStats = asyncHandler(async (req, res) => {
  const trainerId = req.user.id;
  const { enrollmentIds, teamIds, assignments } = await getTrainerActiveTargetIds(trainerId);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [pendingSubmissions, reviewedToday, totalReviewed] = await Promise.all([
    prisma.taskSubmission.count({
      where: {
        reviewStatus: REVIEW_STATUS.PENDING,
        OR: [
          { enrollmentId: { in: enrollmentIds } },
          { taskProgress: { teamId: { in: teamIds } } },
        ],
      },
    }),
    prisma.review.count({
      where: {
        trainerId,
        reviewedAt: { gte: startOfDay },
      },
    }),
    prisma.review.count({
      where: { trainerId },
    }),
  ]);

  ok(res, {
    activeAssignments: assignments.length,
    pendingSubmissions,
    reviewedToday,
    totalReviewed,
  });
});

const getTrainerAssignments = asyncHandler(async (req, res) => {
  const trainerId = req.user.id;
  const search = req.query.search ? String(req.query.search).trim() : null;

  const assignments = await prisma.trainerAssignment.findMany({
    where: { trainerId, active: true },
    include: {
      enrollment: {
        include: {
          user: true,
          plan: { include: { designation: true, domain: true } },
          taskProgress: true,
        },
      },
      team: {
        include: {
          leader: true,
          plan: { include: { designation: true, domain: true } },
          members: { include: { user: true } },
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  const rows = [];
  for (const a of assignments) {
    if (a.enrollment) {
      const e = a.enrollment;
      const progress = e.taskProgress || [];
      const approved = progress.filter((p) => p.status === TASK_STATUS.APPROVED).length;
      const pendingReview = progress.filter((p) => p.status === TASK_STATUS.SUBMITTED).length;

      rows.push({
        _id: a.id,
        targetType: 'INDIVIDUAL',
        assignmentId: a.id,
        enrollmentId: e.id,
        student: {
          _id: e.user.id,
          name: e.user.name,
          email: e.user.email,
        },
        plan: {
          _id: e.plan.id,
          designation: e.plan.designation ? { _id: e.plan.designation.id, name: e.plan.designation.name } : null,
          domain: e.plan.domain ? { _id: e.plan.domain.id, name: e.plan.domain.name } : null,
          durationMonths: e.plan.durationMonths,
        },
        progress: { approved, total: progress.length },
        pendingReviewCount: pendingReview,
        assignedAt: a.assignedAt,
        lastActivityAt: a.assignedAt,
      });
    } else if (a.team) {
      const t = a.team;
      const progress = await prisma.taskProgress.findMany({ where: { teamId: t.id } });
      const approved = progress.filter((p) => p.status === TASK_STATUS.APPROVED).length;
      const pendingReview = progress.filter((p) => p.status === TASK_STATUS.SUBMITTED).length;

      rows.push({
        _id: a.id,
        targetType: 'TEAM',
        assignmentId: a.id,
        teamId: t.id,
        team: {
          _id: t.id,
          name: t.name,
          membersCount: t.members.filter((m) => m.status === 'JOINED').length,
          leader: { _id: t.leader.id, name: t.leader.name, email: t.leader.email },
        },
        plan: {
          _id: t.plan.id,
          designation: t.plan.designation ? { _id: t.plan.designation.id, name: t.plan.designation.name } : null,
          domain: t.plan.domain ? { _id: t.plan.domain.id, name: t.plan.domain.name } : null,
          durationMonths: t.plan.durationMonths,
        },
        progress: { approved, total: progress.length },
        pendingReviewCount: pendingReview,
        assignedAt: a.assignedAt,
        lastActivityAt: a.assignedAt,
      });
    }
  }

  const filtered = search
    ? rows.filter(
        (r) =>
          (r.student?.name && r.student.name.toLowerCase().includes(search.toLowerCase())) ||
          (r.student?.email && r.student.email.toLowerCase().includes(search.toLowerCase())) ||
          (r.team?.name && r.team.name.toLowerCase().includes(search.toLowerCase())),
      )
    : rows;

  ok(res, paginatedResponse(filtered, filtered.length, 1, filtered.length || 10));
});

const getTrainerSubmissions = asyncHandler(async (req, res) => {
  const trainerId = req.user.id;
  const { page, limit, skip } = parsePagination(req.query, 10);
  const status = req.query.status;
  const search = req.query.search ? String(req.query.search).trim() : null;

  const { enrollmentIds, teamIds } = await getTrainerActiveTargetIds(trainerId);

  const where = {
    ...(status && { reviewStatus: status }),
    OR: [
      { enrollmentId: { in: enrollmentIds } },
      { taskProgress: { teamId: { in: teamIds } } },
    ],
  };

  const [total, submissions] = await Promise.all([
    prisma.taskSubmission.count({ where }),
    prisma.taskSubmission.findMany({
      where,
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        taskProgress: {
          include: {
            task: true,
            enrollment: {
              include: {
                user: { select: { id: true, name: true, email: true } },
                team: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
      skip,
      take: limit,
    }),
  ]);

  const items = submissions.map((s) => {
    const tp = s.taskProgress;
    const task = tp?.task;
    const enrollment = tp?.enrollment;

    return {
      _id: s.id,
      taskProgressId: s.taskProgressId,
      attemptNumber: s.attemptNumber,
      reviewStatus: s.reviewStatus,
      submittedAt: s.submittedAt,
      submittedBy: s.submittedBy
        ? { _id: s.submittedBy.id, name: s.submittedBy.name }
        : null,
      task: task
        ? { _id: task.id, title: task.title, sequence: task.sequence, dayNumber: task.dayNumber }
        : null,
      student: enrollment?.user
        ? { _id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email }
        : null,
      team: enrollment?.team
        ? { _id: enrollment.team.id, name: enrollment.team.name }
        : null,
    };
  });

  ok(res, paginatedResponse(items, total, page, limit));
});

const getTrainerSubmissionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const submission = await prisma.taskSubmission.findUnique({
    where: { id },
    include: {
      submittedBy: { select: { id: true, name: true, email: true } },
      review: {
        include: { trainer: { select: { id: true, name: true } } },
      },
      taskProgress: {
        include: {
          task: true,
          enrollment: {
            include: {
              user: { select: { id: true, name: true, email: true } },
              team: { select: { id: true, name: true, repoUrl: true } },
            },
          },
        },
      },
    },
  });

  if (!submission) throw ApiError.notFound('Submission not found.');

  const canAccess = await trainerCanAccessSubmission(req.user.id, submission);
  if (!canAccess && !req.user.roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', NOT_ASSIGNED_MESSAGE);
  }

  const tp = submission.taskProgress;
  const task = tp?.task;
  const enrollment = tp?.enrollment;

  ok(res, {
    _id: submission.id,
    taskProgressId: submission.taskProgressId,
    attemptNumber: submission.attemptNumber,
    description: submission.description,
    githubUrl: submission.githubUrl,
    screenshots: Array.isArray(submission.screenshots)
      ? submission.screenshots
      : JSON.parse(submission.screenshots || '[]'),
    reviewStatus: submission.reviewStatus,
    submittedAt: submission.submittedAt,
    submittedBy: submission.submittedBy
      ? { _id: submission.submittedBy.id, name: submission.submittedBy.name, email: submission.submittedBy.email }
      : null,
    task: task
      ? {
          _id: task.id,
          title: task.title,
          sequence: task.sequence,
          dayNumber: task.dayNumber,
          problemStatement: task.problemStatement,
          expectedOutcome: task.expectedOutcome,
          acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : JSON.parse(task.acceptanceCriteria || '[]'),
          starterRepoUrl: task.starterRepoUrl,
          estimatedHours: task.estimatedHours,
        }
      : null,
    student: enrollment?.user
      ? { _id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email }
      : null,
    team: enrollment?.team
      ? { _id: enrollment.team.id, name: enrollment.team.name, repoUrl: enrollment.team.repoUrl }
      : null,
    review: submission.review
      ? {
          _id: submission.review.id,
          decision: submission.review.decision,
          feedback: submission.review.feedback,
          reviewedAt: submission.review.reviewedAt,
          trainer: submission.review.trainer
            ? { _id: submission.review.trainer.id, name: submission.review.trainer.name }
            : null,
        }
      : null,
  });
});

const reviewSubmission = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { decision, feedback } = req.body;

  const submission = await prisma.taskSubmission.findUnique({
    where: { id },
    include: {
      taskProgress: true,
    },
  });

  if (!submission) throw ApiError.notFound('Submission not found.');

  const canAccess = await trainerCanAccessSubmission(req.user.id, submission);
  if (!canAccess && !req.user.roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', NOT_ASSIGNED_MESSAGE);
  }

  if (submission.submittedById === req.user.id) {
    throw ApiError.forbidden('FORBIDDEN', 'You cannot review your own work.');
  }

  if (submission.reviewStatus !== REVIEW_STATUS.PENDING) {
    throw ApiError.conflict('ALREADY_REVIEWED', 'This submission has already been reviewed.');
  }

  const normalizedDecision = String(decision || '').trim().toUpperCase();
  const text = String(feedback || '').trim();

  if (!Object.values(REVIEW_DECISION).includes(normalizedDecision)) {
    throw ApiError.validationError([{ field: 'decision', message: 'Choose approve, request changes or reject.' }]);
  }

  if (normalizedDecision !== REVIEW_DECISION.APPROVED && text.length < MIN_FEEDBACK_LENGTH) {
    throw ApiError.validationError([
      {
        field: 'feedback',
        message: text
          ? `Write at least ${MIN_FEEDBACK_LENGTH} characters so the student knows what to change.`
          : 'Feedback is required when you request changes or reject.',
      },
    ]);
  }

  // Create or upsert review
  const review = await prisma.review.create({
    data: {
      submissionId: submission.id,
      trainerId: req.user.id,
      decision: normalizedDecision,
      feedback: text,
    },
    include: { trainer: { select: { id: true, name: true } } },
  });

  // Update submission status
  await prisma.taskSubmission.update({
    where: { id: submission.id },
    data: { reviewStatus: normalizedDecision },
  });

  // Update task progress
  const now = new Date();
  if (normalizedDecision === REVIEW_DECISION.APPROVED) {
    await prisma.taskProgress.update({
      where: { id: submission.taskProgressId },
      data: {
        status: TASK_STATUS.APPROVED,
        approvedAt: now,
        lastReviewStatus: REVIEW_STATUS.APPROVED,
      },
    });

    const tp = submission.taskProgress;
    await unlockDependents(tp.enrollmentId, tp.teamId);
    await checkCertificateEligibility(tp.enrollmentId, tp.teamId);
  } else {
    await prisma.taskProgress.update({
      where: { id: submission.taskProgressId },
      data: {
        status: TASK_STATUS.CHANGES_REQUESTED,
        lastReviewStatus: normalizedDecision,
      },
    });
  }

  // Next pending submission for trainer
  const { enrollmentIds, teamIds } = await getTrainerActiveTargetIds(req.user.id);
  const nextPending = await prisma.taskSubmission.findFirst({
    where: {
      id: { not: submission.id },
      reviewStatus: REVIEW_STATUS.PENDING,
      OR: [
        { enrollmentId: { in: enrollmentIds } },
        { taskProgress: { teamId: { in: teamIds } } },
      ],
    },
    orderBy: { submittedAt: 'asc' },
  });

  ok(res, {
    review: {
      _id: review.id,
      submissionId: review.submissionId,
      trainerId: review.trainerId,
      decision: review.decision,
      feedback: review.feedback,
      reviewedAt: review.reviewedAt,
      trainer: review.trainer ? { _id: review.trainer.id, name: review.trainer.name } : null,
    },
    submission: {
      _id: submission.id,
      reviewStatus: normalizedDecision,
    },
    nextPendingId: nextPending ? nextPending.id : null,
  });
});

module.exports = {
  getTrainerStats,
  getTrainerAssignments,
  getTrainerSubmissions,
  getTrainerSubmissionById,
  reviewSubmission,
};
