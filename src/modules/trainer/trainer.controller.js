'use strict';

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
  ENROLLMENT_TYPE,
  MEMBER_STATUS,
} = require('../../common/constants');
const {
  sendCertificateIssuedEmail,
  sendTaskReviewedEmail,
} = require('../../libs/email');
const { addAudit } = require('../audit-log/audit-log.service');
const {
  createNotificationsForUsers,
  notifyAdmins,
} = require('../notifications/services/notifications.service');
const logger = require('../../libs/logger');

const NOT_ASSIGNED_MESSAGE = "This submission isn't assigned to you.";
const MIN_FEEDBACK_LENGTH = 10;

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

function planRef(plan) {
  if (!plan) return null;
  return {
    _id: plan.id,
    durationMonths: plan.durationMonths,
    basePrice: plan.basePrice,
    currency: plan.currency || 'INR',
    designation: plan.designation
      ? { _id: plan.designation.id, name: plan.designation.name, slug: plan.designation.slug }
      : null,
    domain: plan.domain
      ? { _id: plan.domain.id, name: plan.domain.name, slug: plan.domain.slug }
      : null,
  };
}

function projectRef(project) {
  if (!project) return null;
  return {
    _id: project.id,
    title: project.title,
    slug: project.slug,
  };
}

function buildTrainerSubmissionWhere(enrollmentIds, teamIds) {
  const or = [];
  if (enrollmentIds.length > 0) {
    or.push({ enrollmentId: { in: enrollmentIds } });
    or.push({ taskProgress: { enrollmentId: { in: enrollmentIds } } });
  }
  if (teamIds.length > 0) {
    or.push({ taskProgress: { teamId: { in: teamIds } } });
    or.push({ taskProgress: { enrollment: { teamId: { in: teamIds } } } });
  }
  return or;
}

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
  if (submission.taskProgress?.enrollmentId && enrollmentIds.includes(submission.taskProgress.enrollmentId)) {
    return true;
  }
  if (submission.taskProgress?.teamId && teamIds.includes(submission.taskProgress.teamId)) {
    return true;
  }
  if (submission.taskProgress?.enrollment?.teamId && teamIds.includes(submission.taskProgress.enrollment.teamId)) {
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
    const prereqs = parseJsonArray(p.task?.prerequisiteTaskIds);
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

  const allProgress = await prisma.taskProgress.findMany({ where });

  if (allProgress.length === 0 || !allProgress.every((p) => p.status === TASK_STATUS.APPROVED)) {
    return;
  }

  const targetEnrollments = await prisma.enrollment.findMany({
    where: teamId
      ? { teamId, status: { not: ENROLLMENT_STATUS.CANCELLED } }
      : { id: enrollmentId },
    include: { user: true, plan: { include: { designation: true } } },
  });

  for (const enrollment of targetEnrollments) {
    if (enrollment.status === ENROLLMENT_STATUS.COMPLETED) continue;

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
      await createNotificationsForUsers([enrollment.user.id], {
        type: 'CERTIFICATE_ISSUED',
        title: `Certificate issued (${certNo})`,
        message: `Congratulations! All tasks are approved and your ${enrollment.plan?.designation?.name || 'internship'} certificate is ready to download.`,
        link: '/certificate',
        metadata: { certificateId: certificate.id, certificateNo: certNo },
      });

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

async function findNextPendingForTrainer(trainerId, excludeSubmissionId) {
  const { enrollmentIds, teamIds } = await getTrainerActiveTargetIds(trainerId);
  const or = buildTrainerSubmissionWhere(enrollmentIds, teamIds);
  if (or.length === 0) return null;

  const next = await prisma.taskSubmission.findFirst({
    where: {
      ...(excludeSubmissionId && { id: { not: excludeSubmissionId } }),
      reviewStatus: REVIEW_STATUS.PENDING,
      OR: or,
    },
    orderBy: { submittedAt: 'asc' },
    select: { id: true },
  });

  return next?.id || null;
}

function computeLastActivity(progressList, fallback) {
  let latest = null;
  for (const p of progressList || []) {
    const candidates = [p.startedAt, p.submittedAt, p.approvedAt, p.updatedAt];
    if (Array.isArray(p.submissions)) {
      p.submissions.forEach((s) => candidates.push(s.submittedAt));
    }
    for (const dt of candidates) {
      if (!dt) continue;
      const t = new Date(dt).getTime();
      if (!Number.isNaN(t) && (!latest || t > latest.getTime())) {
        latest = new Date(t);
      }
    }
  }
  return latest || fallback || null;
}

/**
 * Shared atomic review execution used by both Trainers (`POST /trainer/submissions/:id/review`)
 * and Admins (`POST /admin/submissions/:id/review` for escalated or unassigned submissions).
 */
async function executeSubmissionReview({
  reviewer,
  submissionId,
  decision,
  feedback,
  ip = null,
  allowAdminOverride = false,
}) {
  const submission = await prisma.taskSubmission.findUnique({
    where: { id: submissionId },
    include: {
      submittedBy: { select: { id: true, name: true, email: true } },
      taskProgress: {
        include: {
          task: true,
          enrollment: {
            include: {
              user: { select: { id: true, name: true, email: true } },
              team: {
                include: {
                  members: {
                    where: { status: MEMBER_STATUS.JOINED },
                    include: { user: { select: { id: true, name: true, email: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!submission) throw ApiError.notFound('Submission not found.');

  const isAdmin = allowAdminOverride && reviewer.roles.includes(ROLES.ADMIN);
  if (!isAdmin) {
    const canAccess = await trainerCanAccessSubmission(reviewer.id, submission);
    if (!canAccess) {
      throw ApiError.forbidden('FORBIDDEN', NOT_ASSIGNED_MESSAGE);
    }
  }

  if (submission.submittedById === reviewer.id) {
    throw ApiError.forbidden('FORBIDDEN', 'You cannot review your own work.');
  }

  const reviewableStatuses = isAdmin
    ? [REVIEW_STATUS.PENDING, REVIEW_STATUS.ESCALATED]
    : [REVIEW_STATUS.PENDING];

  if (!reviewableStatuses.includes(submission.reviewStatus)) {
    throw ApiError.conflict('ALREADY_REVIEWED', 'This submission has already been reviewed.');
  }

  const normalizedDecision = String(decision || '').trim().toUpperCase();
  const text = String(feedback || '').trim();

  if (!Object.values(REVIEW_DECISION).includes(normalizedDecision)) {
    throw ApiError.validationError([
      { field: 'decision', message: 'Choose approve, request changes, reject or escalate.' },
    ]);
  }

  if (isAdmin && normalizedDecision === REVIEW_DECISION.ESCALATED) {
    throw ApiError.validationError([
      { field: 'decision', message: 'Choose approve, request changes or reject to resolve an escalation.' },
    ]);
  }

  if (normalizedDecision !== REVIEW_DECISION.APPROVED && text.length < MIN_FEEDBACK_LENGTH) {
    throw ApiError.validationError([
      {
        field: 'feedback',
        message: text
          ? `Write at least ${MIN_FEEDBACK_LENGTH} characters so the student knows what to change.`
          : 'Feedback is required when you request changes, reject or escalate.',
      },
    ]);
  }

  const now = new Date();
  let nextProgressData;
  if (normalizedDecision === REVIEW_DECISION.APPROVED) {
    nextProgressData = {
      status: TASK_STATUS.APPROVED,
      approvedAt: now,
      lastReviewStatus: REVIEW_STATUS.APPROVED,
    };
  } else if (normalizedDecision === REVIEW_DECISION.ESCALATED) {
    nextProgressData = {
      status: TASK_STATUS.SUBMITTED,
      lastReviewStatus: REVIEW_STATUS.ESCALATED,
    };
  } else {
    nextProgressData = {
      status: TASK_STATUS.CHANGES_REQUESTED,
      lastReviewStatus: normalizedDecision,
    };
  }

  const review = await prisma.$transaction(async (tx) => {
    // Upsert review so an Admin resolving an ESCALATED submission updates the existing Review row cleanly
    const savedReview = await tx.review.upsert({
      where: { submissionId: submission.id },
      create: {
        submissionId: submission.id,
        trainerId: reviewer.id,
        decision: normalizedDecision,
        feedback: text,
        reviewedAt: now,
      },
      update: {
        trainerId: reviewer.id,
        decision: normalizedDecision,
        feedback: text,
        reviewedAt: now,
      },
      include: { trainer: { select: { id: true, name: true } } },
    });

    await tx.taskSubmission.update({
      where: { id: submission.id },
      data: { reviewStatus: normalizedDecision },
    });

    await tx.taskProgress.update({
      where: { id: submission.taskProgressId },
      data: nextProgressData,
    });

    return savedReview;
  });

  const tp = submission.taskProgress;
  if (normalizedDecision === REVIEW_DECISION.APPROVED) {
    await unlockDependents(tp.enrollmentId, tp.teamId);
    await checkCertificateEligibility(tp.enrollmentId, tp.teamId);
  }

  await addAudit({
    actorId: reviewer.id,
    action:
      normalizedDecision === REVIEW_DECISION.ESCALATED
        ? 'SUBMISSION_ESCALATED'
        : 'SUBMISSION_REVIEWED',
    entityType: 'TaskSubmission',
    entityId: submission.id,
    before: { reviewStatus: submission.reviewStatus },
    after: {
      decision: normalizedDecision,
      taskProgressId: submission.taskProgressId,
      resolvedByAdmin: isAdmin,
    },
    ip,
  });

  // Notify stakeholders
  const taskTitle = tp?.task?.title || 'Task';
  const enrollment = tp?.enrollment;
  const studentRecipients = enrollment?.team?.members?.length
    ? enrollment.team.members.map((m) => m.user).filter(Boolean)
    : enrollment?.user
      ? [enrollment.user]
      : submission.submittedBy
        ? [submission.submittedBy]
        : [];

  if (normalizedDecision === REVIEW_DECISION.ESCALATED) {
    await notifyAdmins({
      type: 'SUBMISSION_ESCALATED',
      title: `Escalated submission: ${taskTitle}`,
      message: `${reviewer.name} escalated attempt #${submission.attemptNumber} for second-tier review.`,
      link: '/admin/submissions?status=ESCALATED',
      metadata: { submissionId: submission.id, taskProgressId: submission.taskProgressId },
    });
  } else if (studentRecipients.length > 0) {
    const labelMap = {
      APPROVED: 'approved',
      CHANGES_REQUESTED: 'marked as changes requested',
      REJECTED: 'rejected',
    };
    await createNotificationsForUsers(
      studentRecipients.map((u) => u.id),
      {
        type: `TASK_${normalizedDecision}`,
        title: `Task ${normalizedDecision === 'APPROVED' ? 'Approved' : 'Review Update'}: ${taskTitle}`,
        message:
          normalizedDecision === REVIEW_DECISION.APPROVED
            ? `Your work on "${taskTitle}" was approved by ${reviewer.name}. Any dependent tasks are now unlocked.`
            : `Your submission for "${taskTitle}" was ${labelMap[normalizedDecision] || 'reviewed'}. Check the feedback and resubmit.`,
        link: `/tasks/${submission.taskProgressId}?tab=history`,
        metadata: { submissionId: submission.id, decision: normalizedDecision },
      },
    );

    studentRecipients.forEach((u) => {
      if (!u.email) return;
      sendTaskReviewedEmail({
        to: u.email,
        studentName: u.name,
        taskTitle,
        decision: normalizedDecision,
        feedback: text,
        taskProgressId: submission.taskProgressId,
      }).catch((err) => logger.warn(`[Trainer] Failed to email student ${u.email}: ${err.message}`));
    });
  }

  const nextPendingId = isAdmin ? null : await findNextPendingForTrainer(reviewer.id, submission.id);

  return {
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
    nextPendingId,
  };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const getTrainerStats = asyncHandler(async (req, res) => {
  const trainerId = req.user.id;
  const { enrollmentIds, teamIds, assignments } = await getTrainerActiveTargetIds(trainerId);
  const subOr = buildTrainerSubmissionWhere(enrollmentIds, teamIds);

  const progressOr = [];
  if (enrollmentIds.length > 0) progressOr.push({ enrollmentId: { in: enrollmentIds } });
  if (teamIds.length > 0) progressOr.push({ teamId: { in: teamIds } });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [pending, changesRequested, reviewedToday, totalReviewed] = await Promise.all([
    subOr.length > 0
      ? prisma.taskSubmission.count({
          where: {
            reviewStatus: REVIEW_STATUS.PENDING,
            OR: subOr,
          },
        })
      : Promise.resolve(0),
    progressOr.length > 0
      ? prisma.taskProgress.count({
          where: {
            status: TASK_STATUS.CHANGES_REQUESTED,
            OR: progressOr,
          },
        })
      : Promise.resolve(0),
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

  const assignedStudents = assignments.filter((a) => Boolean(a.enrollmentId) && !a.teamId).length;
  const assignedTeams = assignments.filter((a) => Boolean(a.teamId)).length;

  ok(res, {
    // Frontend contract keys
    pending,
    changesRequested,
    reviewedToday,
    assignedStudents,
    assignedTeams,
    // Backward-compatible keys
    activeAssignments: assignments.length,
    pendingSubmissions: pending,
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
          project: true,
          taskProgress: {
            include: {
              submissions: {
                select: { id: true, reviewStatus: true, submittedAt: true },
              },
            },
          },
        },
      },
      team: {
        include: {
          leader: true,
          plan: { include: { designation: true, domain: true } },
          members: { include: { user: true } },
          enrollments: {
            where: { status: { not: ENROLLMENT_STATUS.CANCELLED } },
            include: { project: true },
            take: 1,
          },
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
      const approvedTasks = progress.filter((p) => p.status === TASK_STATUS.APPROVED).length;
      const totalTasks = progress.length;
      const pendingSubmissions = progress.reduce(
        (sum, p) =>
          sum + (p.submissions || []).filter((s) => s.reviewStatus === REVIEW_STATUS.PENDING).length,
        0,
      );
      const lastActivityAt = computeLastActivity(progress, e.activatedAt || a.assignedAt);

      rows.push({
        _id: a.id,
        type: ENROLLMENT_TYPE.INDIVIDUAL,
        targetType: ENROLLMENT_TYPE.INDIVIDUAL,
        assignmentId: a.id,
        enrollmentId: e.id,
        teamId: null,
        student: {
          _id: e.user.id,
          name: e.user.name,
          email: e.user.email,
        },
        team: null,
        plan: planRef(e.plan),
        project: projectRef(e.project),
        track: e.track || 'web',
        approvedTasks,
        totalTasks,
        pendingSubmissions,
        progress: { approved: approvedTasks, total: totalTasks },
        pendingReviewCount: pendingSubmissions,
        assignedAt: a.assignedAt,
        lastActivityAt,
      });
    } else if (a.team) {
      const t = a.team;
      const progress = await prisma.taskProgress.findMany({
        where: { teamId: t.id },
        include: {
          submissions: {
            select: { id: true, reviewStatus: true, submittedAt: true },
          },
        },
      });
      const approvedTasks = progress.filter((p) => p.status === TASK_STATUS.APPROVED).length;
      const totalTasks = progress.length;
      const pendingSubmissions = progress.reduce(
        (sum, p) =>
          sum + (p.submissions || []).filter((s) => s.reviewStatus === REVIEW_STATUS.PENDING).length,
        0,
      );
      const teamEnrollment = t.enrollments?.[0] || null;
      const lastActivityAt = computeLastActivity(progress, teamEnrollment?.activatedAt || t.updatedAt || a.assignedAt);

      rows.push({
        _id: a.id,
        type: ENROLLMENT_TYPE.TEAM,
        targetType: ENROLLMENT_TYPE.TEAM,
        assignmentId: a.id,
        enrollmentId: null,
        teamId: t.id,
        student: null,
        team: {
          _id: t.id,
          name: t.name,
          membersCount: t.members.filter((m) => m.status === MEMBER_STATUS.JOINED).length,
          leader: { _id: t.leader.id, name: t.leader.name, email: t.leader.email },
        },
        plan: planRef(t.plan),
        project: projectRef(teamEnrollment?.project),
        track: teamEnrollment?.track || 'web',
        approvedTasks,
        totalTasks,
        pendingSubmissions,
        progress: { approved: approvedTasks, total: totalTasks },
        pendingReviewCount: pendingSubmissions,
        assignedAt: a.assignedAt,
        lastActivityAt,
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
  const sortParam = req.query.sort ? String(req.query.sort) : 'submittedAt:asc';

  const { enrollmentIds, teamIds } = await getTrainerActiveTargetIds(trainerId);
  const or = buildTrainerSubmissionWhere(enrollmentIds, teamIds);

  if (or.length === 0) {
    return ok(res, paginatedResponse([], 0, page, limit));
  }

  const andClauses = [{ OR: or }];
  if (status) {
    andClauses.push({ reviewStatus: status });
  }
  if (search) {
    andClauses.push({
      OR: [
        { submittedBy: { name: { contains: search, mode: 'insensitive' } } },
        { submittedBy: { email: { contains: search, mode: 'insensitive' } } },
        { taskProgress: { task: { title: { contains: search, mode: 'insensitive' } } } },
        { taskProgress: { enrollment: { user: { name: { contains: search, mode: 'insensitive' } } } } },
        { taskProgress: { enrollment: { user: { email: { contains: search, mode: 'insensitive' } } } } },
        { taskProgress: { enrollment: { team: { name: { contains: search, mode: 'insensitive' } } } } },
      ],
    });
  }

  const where = { AND: andClauses };
  const [sortField, sortDir] = sortParam.split(':');
  const orderDir = sortDir === 'desc' ? 'desc' : 'asc';
  const orderBy =
    sortField === 'attemptNumber'
      ? { attemptNumber: orderDir }
      : { submittedAt: orderDir };

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
                plan: { include: { designation: true, domain: true } },
                project: true,
              },
            },
          },
        },
      },
      orderBy,
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
      enrollmentId: s.enrollmentId || tp?.enrollmentId || null,
      attemptNumber: s.attemptNumber,
      reviewStatus: s.reviewStatus,
      submittedAt: s.submittedAt,
      submittedBy: s.submittedBy
        ? { _id: s.submittedBy.id, name: s.submittedBy.name }
        : null,
      task: task
        ? { _id: task.id, title: task.title, sequence: task.sequence, dayNumber: task.dayNumber }
        : null,
      student: enrollment?.team
        ? null
        : enrollment?.user
          ? { _id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email }
          : null,
      team: enrollment?.team
        ? { _id: enrollment.team.id, name: enrollment.team.name }
        : null,
      plan: planRef(enrollment?.plan),
      project: projectRef(enrollment?.project),
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
              plan: { include: { designation: true, domain: true } },
              project: true,
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

  const [previousRaw, nextPendingId] = await Promise.all([
    prisma.taskSubmission.findMany({
      where: {
        taskProgressId: submission.taskProgressId,
        id: { not: submission.id },
      },
      include: {
        submittedBy: { select: { id: true, name: true } },
        review: { include: { trainer: { select: { id: true, name: true } } } },
      },
      orderBy: [{ attemptNumber: 'desc' }, { submittedAt: 'desc' }],
    }),
    findNextPendingForTrainer(req.user.id, submission.id),
  ]);

  const previousAttempts = previousRaw.map((prev) => ({
    _id: prev.id,
    taskProgressId: prev.taskProgressId,
    attemptNumber: prev.attemptNumber,
    description: prev.description,
    githubUrl: prev.githubUrl,
    screenshots: parseJsonArray(prev.screenshots),
    reviewStatus: prev.reviewStatus,
    submittedAt: prev.submittedAt,
    submittedBy: prev.submittedBy ? { _id: prev.submittedBy.id, name: prev.submittedBy.name } : null,
    review: prev.review
      ? {
          _id: prev.review.id,
          decision: prev.review.decision,
          feedback: prev.review.feedback,
          reviewedAt: prev.review.reviewedAt,
          trainer: prev.review.trainer
            ? { _id: prev.review.trainer.id, name: prev.review.trainer.name }
            : null,
        }
      : null,
  }));

  const tp = submission.taskProgress;
  const task = tp?.task;
  const enrollment = tp?.enrollment;

  ok(res, {
    _id: submission.id,
    taskProgressId: submission.taskProgressId,
    enrollmentId: submission.enrollmentId || tp?.enrollmentId || null,
    attemptNumber: submission.attemptNumber,
    description: submission.description,
    githubUrl: submission.githubUrl,
    screenshots: parseJsonArray(submission.screenshots),
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
          acceptanceCriteria: parseJsonArray(task.acceptanceCriteria),
          starterRepoUrl: task.starterRepoUrl,
          estimatedHours: task.estimatedHours,
          requiresTrainerReview: task.requiresTrainerReview,
        }
      : null,
    student: enrollment?.team
      ? null
      : enrollment?.user
        ? { _id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email }
        : null,
    team: enrollment?.team
      ? { _id: enrollment.team.id, name: enrollment.team.name, repoUrl: enrollment.team.repoUrl }
      : null,
    plan: planRef(enrollment?.plan),
    project: projectRef(enrollment?.project),
    track: enrollment?.track || 'web',
    previousAttempts,
    automatedChecks: [],
    nextPendingId,
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

  const result = await executeSubmissionReview({
    reviewer: req.user,
    submissionId: id,
    decision,
    feedback,
    ip: req.ip,
    allowAdminOverride: false,
  });

  ok(res, result);
});

module.exports = {
  getTrainerStats,
  getTrainerAssignments,
  getTrainerSubmissions,
  getTrainerSubmissionById,
  reviewSubmission,
  executeSubmissionReview,
  unlockDependents,
  checkCertificateEligibility,
};
