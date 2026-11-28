const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  paginatedResponse,
  hashPassword,
} = require('../../utils');
const {
  ROLES,
  PUBLISH_STATUS,
  SCHEDULE_STATUS,
  ENROLLMENT_STATUS,
  ENROLLMENT_TYPE,
  PAYMENT_STATUS,
  TASK_STATUS,
  TEAM_STATUS,
  MEMBER_STATUS,
} = require('../../common/constants');
const { sendPaymentSuccessEmail } = require('../../libs/email');
const { computeTeamReadiness } = require('../teams/teams.controller');
const { notifyAdmins } = require('../notifications/services/notifications.service');
const { syncProjectTasksToEnrollment } = require('../admin/services/project-task-sync.service');
const { normalizeReferralCode } = require('../admin/services/tpo-code.util');
const { recordTpoEarningForPayment } = require('../tpo/services/tpo-earnings.service');
const { InternshipsService } = require('../internships/services/internships.service');
const { InternshipsModel } = require('../internships/internships.model');
const logger = require('../../libs/logger');

const QUOTE_TTL_HOURS = 24;

// ─── Student: Submit a Change Trainer Request ────────────────────────────────

const submitChangeTrainerRequest = asyncHandler(async (req, res) => {
  const studentId = req.user.id;
  const { enrollmentId, reason, mobile } = req.body;

  if (!enrollmentId) {
    throw ApiError.validationError([
      { field: 'enrollmentId', message: 'Enrollment ID is required.' },
    ]);
  }

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason || trimmedReason.length < 10) {
    throw ApiError.validationError([
      { field: 'reason', message: 'Please provide a reason (at least 10 characters).' },
    ]);
  }

  // Verify enrollment belongs to this student
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, userId: studentId },
    include: {
      trainerAssignments: {
        where: { active: true },
        take: 1,
      },
    },
  });

  if (!enrollment) {
    throw ApiError.notFound('Enrollment not found or does not belong to you.');
  }

  // Check for existing pending request
  const existing = await prisma.trainerChangeRequest.findFirst({
    where: { studentId, enrollmentId, status: 'PENDING' },
  });

  if (existing) {
    throw ApiError.conflict(
      'DUPLICATE_REQUEST',
      'You already have a pending trainer change request for this enrollment.',
    );
  }

  const currentTrainerId = enrollment.trainerAssignments?.[0]?.trainerId || null;

  const changeRequest = await prisma.trainerChangeRequest.create({
    data: {
      studentId,
      enrollmentId,
      currentTrainerId,
      reason: trimmedReason,
      mobile: mobile ? String(mobile).trim() : null,
      status: 'PENDING',
    },
  });

  ok(res, {
    _id: changeRequest.id,
    status: changeRequest.status,
    message: 'Your request to change trainer has been submitted successfully.',
  });
});

function planRef(plan) {
  if (!plan) return null;
  return {
    _id: plan.id,
    durationMonths: plan.durationMonths,
    basePrice: plan.basePrice,
    discountPercent: Number(plan.discountPercent) || 0,
    currency: plan.currency || 'INR',
    designation: plan.designation
      ? { _id: plan.designation.id, name: plan.designation.name, slug: plan.designation.slug }
      : null,
    domain: plan.domain
      ? { _id: plan.domain.id, name: plan.domain.name, slug: plan.domain.slug }
      : null,
  };
}

function projectSummaryDto(project) {
  if (!project) return null;
  return {
    _id: project.id,
    title: project.title,
    slug: project.slug,
    description: project.description || '',
    starterRepoUrl: project.starterRepoUrl || '',
    appStarterRepoUrl: project.appStarterRepoUrl || '',
    technologies: Array.isArray(project.technologies) ? project.technologies : [],
    webTechStack: Array.isArray(project.webTechStack) ? project.webTechStack : [],
    webDeliverables: project.webDeliverables || '',
    appTechStack: Array.isArray(project.appTechStack) ? project.appTechStack : [],
    appDeliverables: project.appDeliverables || '',
    domain: project.domain
      ? { _id: project.domain.id, name: project.domain.name, slug: project.domain.slug }
      : null,
  };
}

function buildMentorDto(enrollment) {
  const activeAssignment =
    enrollment.trainerAssignments?.find((a) => a.active && a.trainer) ||
    enrollment.team?.trainerAssignments?.find((a) => a.active && a.trainer) ||
    null;

  const trainer = activeAssignment?.trainer;
  if (!trainer) return null;

  const tp = trainer.trainerProfile;
  return {
    _id: trainer.id,
    name: trainer.name,
    email: trainer.email,
    avatarUrl: trainer.avatarUrl || null,
    designation: trainer.headline || (tp?.domain ? `${tp.domain} Mentor` : 'Engineering Mentor'),
    organization: tp?.organization || trainer.organization || 'ALFRE Engineering Network',
    bio: tp?.bio || trainer.bio || 'Assigned internship mentor responsible for reviewing your GitHub submissions and guiding milestone sign-off.',
    domain: tp?.domain || null,
    experience: tp?.experience || null,
    linkedinUrl: tp?.linkedinUrl || trainer.linkedinUrl || null,
    specialties: [tp?.domain, 'Code Review', 'GitHub Workflows'].filter(Boolean),
    availability: 'Assigned Reviewer',
  };
}

function quoteDto(quote) {
  if (!quote) return null;
  return {
    _id: quote.id,
    quoteId: quote.id,
    userId: quote.userId,
    planId: quote.planId,
    enrollmentType: quote.enrollmentType,
    teamId: quote.teamId || null,
    attemptId: quote.attemptId || null,
    basePrice: quote.basePrice,
    discountPercent: quote.discountPercent,
    payableAmount: quote.payableAmount,
    currency: quote.currency || 'INR',
    expiresAt: quote.expiresAt,
    createdAt: quote.createdAt,
  };
}

function termsDto(terms) {
  if (!terms) return null;
  return {
    version: terms.version,
    content: terms.content || '',
    publishedAt: terms.publishedAt,
  };
}

function termsAcceptanceDto(acceptance) {
  if (!acceptance) return null;
  return {
    _id: acceptance.id,
    enrollmentId: acceptance.enrollmentId,
    termsVersion: acceptance.termsVersion,
    acceptedAt: acceptance.acceptedAt,
  };
}

function enrollmentDto(enrollment, latestPayment, team, plan, progressCount, certificate) {
  if (!enrollment) return null;

  const mentor = buildMentorDto(enrollment);
  const formattedPlan = planRef(plan);
  const snapshotDesignation =
    enrollment.priceSnapshot?.designationName || enrollment.priceSnapshot?.roleName;
  if (snapshotDesignation && formattedPlan) {
    if (!formattedPlan.designation) {
      formattedPlan.designation = { _id: null, name: snapshotDesignation, slug: '' };
    } else if (
      formattedPlan.designation.name &&
      formattedPlan.designation.name.toLowerCase() !== snapshotDesignation.toLowerCase()
    ) {
      formattedPlan.designation = {
        ...formattedPlan.designation,
        name: snapshotDesignation,
      };
    }
  }

  return {
    _id: enrollment.id,
    userId: enrollment.userId,
    teamId: enrollment.teamId || null,
    team: team ? { _id: team.id, name: team.name } : null,
    planId: enrollment.planId,
    plan: formattedPlan,
    quoteId: enrollment.quoteId || null,
    mentor,
    assignedTrainer: mentor,
    enrollmentType:
      enrollment.enrollmentType ||
      (enrollment.teamId ? ENROLLMENT_TYPE.TEAM : ENROLLMENT_TYPE.INDIVIDUAL),
    scheduleTemplateId: enrollment.scheduleTemplateId || null,
    scheduleVersion: enrollment.scheduleVersion || null,
    priceSnapshot: enrollment.priceSnapshot,
    status: enrollment.status,
    paymentStatus: latestPayment?.status || null,
    termsAcceptedVersion: enrollment.termsAcceptedVersion || null,
    progress: progressCount || { approved: 0, total: 0 },
    certificateId: certificate?.id || null,
    track: enrollment.track || 'web',
    projectId: enrollment.projectId || null,
    project: enrollment.project ? projectSummaryDto(enrollment.project) : null,
    projectAssignedAt: enrollment.projectAssignedAt || null,
    createdAt: enrollment.createdAt,
    activatedAt: enrollment.activatedAt || null,
    completedAt: enrollment.completedAt || null,
  };
}

// ─── Terms Handlers ──────────────────────────────────────────────────────────

const getLatestTerms = asyncHandler(async (_req, res) => {
  const terms = await prisma.termsVersion.findFirst({
    orderBy: { version: 'desc' },
  });

  if (!terms) {
    throw ApiError.notFound('Terms and conditions not found.');
  }

  ok(res, termsDto(terms));
});

const acceptTerms = asyncHandler(async (req, res) => {
  const { enrollmentId, termsVersion } = req.body;
  const versionNum = Number(termsVersion);

  const details = [];
  if (!enrollmentId) details.push({ field: 'enrollmentId', message: 'Enrollment is required.' });
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    details.push({ field: 'termsVersion', message: 'Accept the terms to continue.' });
  }
  if (details.length > 0) throw ApiError.validationError(details);

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: String(enrollmentId).trim() },
  });
  if (!enrollment) throw ApiError.notFound('Enrollment not found.');
  if (enrollment.userId !== req.user.id) {
    throw ApiError.forbidden('FORBIDDEN', 'You can only accept terms for your own enrollments.');
  }

  const latest = await prisma.termsVersion.findFirst({
    orderBy: { version: 'desc' },
  });
  if (!latest) throw ApiError.notFound('Terms not found.');

  if (versionNum !== latest.version) {
    const msg = `The terms were updated to version ${latest.version}. Please read them and accept again.`;
    throw ApiError.conflict('TERMS_OUTDATED', msg, [{ field: 'termsVersion', message: msg }]);
  }

  // Idempotent
  let acceptance = await prisma.termsAcceptance.findFirst({
    where: {
      enrollmentId: enrollment.id,
      termsVersion: latest.version,
    },
  });

  if (!acceptance) {
    acceptance = await prisma.termsAcceptance.create({
      data: {
        userId: req.user.id,
        enrollmentId: enrollment.id,
        termsVersion: latest.version,
      },
    });

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { termsAcceptedVersion: latest.version },
    });
  }

  created(res, termsAcceptanceDto(acceptance));
});

// ─── Quote Handlers ──────────────────────────────────────────────────────────

const createQuote = asyncHandler(async (req, res) => {
  const { planId, teamId } = req.body;
  const details = [];
  if (!planId) details.push({ field: 'planId', message: 'Choose a plan.' });
  if (details.length > 0) throw ApiError.validationError(details);

  const plan = await prisma.internshipPlan.findUnique({
    where: { id: String(planId).trim() },
    include: { designation: true },
  });
  if (!plan || plan.status !== PUBLISH_STATUS.PUBLISHED) {
    throw ApiError.notFound('Plan not found.');
  }

  // Assessment is optional (direct pricing & direct enrollment enabled);
  // if the student has an attempt, honor the better discount between plan & attempt.
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: {
      userId_designationId: {
        userId: req.user.id,
        designationId: plan.designationId,
      },
    },
  });

  let team = null;
  if (teamId) {
    team = await prisma.team.findUnique({
      where: { id: String(teamId).trim() },
      include: { members: true },
    });
    if (!team) throw ApiError.notFound('Team not found.');
    const isMember = team.members.some(
      (m) => m.userId === req.user.id && [MEMBER_STATUS.JOINED, MEMBER_STATUS.INVITED].includes(m.status),
    );
    if (!isMember) {
      throw ApiError.forbidden('FORBIDDEN', 'Join this team before requesting a team quote.');
    }
    if (team.status === TEAM_STATUS.DISBANDED) {
      throw ApiError.badRequest('INVALID_TRANSITION', 'This team has been disbanded.');
    }
    if (team.planId !== plan.id) {
      throw ApiError.validationError([
        { field: 'planId', message: "This plan doesn't match your team's plan." },
      ]);
    }
  }

  // Team quote discount is always 0%; individual uses direct plan discount (or assessment discount if higher)
  const planDiscount = Number(plan.discountPercent) || 0;
  const attemptDiscount = Number(attempt?.discountPercent) || 0;
  const discountPercent = team ? 0 : Math.max(planDiscount, attemptDiscount);
  const payableAmount = Math.round(plan.basePrice * (1 - discountPercent / 100));
  const expiresAt = new Date(Date.now() + QUOTE_TTL_HOURS * 60 * 60 * 1000);

  const quote = await prisma.quote.create({
    data: {
      userId: req.user.id,
      planId: plan.id,
      enrollmentType: team ? ENROLLMENT_TYPE.TEAM : ENROLLMENT_TYPE.INDIVIDUAL,
      teamId: team ? team.id : null,
      attemptId: attempt ? attempt.id : null,
      basePrice: plan.basePrice,
      discountPercent,
      payableAmount,
      currency: plan.currency || 'INR',
      expiresAt,
    },
  });

  created(res, quoteDto(quote));
});

// ─── Enrollment Handlers ─────────────────────────────────────────────────────

const createEnrollment = asyncHandler(async (req, res) => {
  const { quoteId, track } = req.body;
  const normalizedTrack = String(track || 'web').toLowerCase() === 'app' ? 'app' : 'web';
  if (!quoteId) {
    throw ApiError.validationError([{ field: 'quoteId', message: 'Get a price quote first.' }]);
  }

  const quote = await prisma.quote.findUnique({
    where: { id: String(quoteId).trim() },
    include: { plan: { include: { designation: true, domain: true } } },
  });

  if (!quote) throw ApiError.notFound('Quote not found.');
  if (quote.userId !== req.user.id) {
    throw ApiError.forbidden('FORBIDDEN', 'This quote belongs to another account.');
  }

  // Check if quote was already converted
  const existingEnrollment = await prisma.enrollment.findFirst({
    where: { quoteId: quote.id },
  });
  if (existingEnrollment) {
    if (
      existingEnrollment.userId === req.user.id &&
      existingEnrollment.status === ENROLLMENT_STATUS.PENDING_PAYMENT
    ) {
      return created(res, enrollmentDto(existingEnrollment, null, null, quote.plan, null, null));
    }
    throw ApiError.conflict(
      'QUOTE_ALREADY_USED',
      'This quote has already been used. Get a new quote to continue.',
    );
  }

  if (new Date() > quote.expiresAt) {
    throw ApiError.gone(
      'QUOTE_EXPIRED',
      'This quote has expired. Refresh it to see the current price.',
    );
  }

  // Check team if applicable
  if (quote.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: quote.teamId },
      include: { members: true },
    });
    if (!team || team.status === TEAM_STATUS.DISBANDED) {
      throw ApiError.badRequest('INVALID_TRANSITION', 'This team is no longer available.');
    }
  }

  // Check if user already has an active enrollment for this plan & team
  const activeExisting = await prisma.enrollment.findFirst({
    where: {
      userId: req.user.id,
      planId: quote.planId,
      teamId: quote.teamId || null,
      status: { in: [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.IN_PROGRESS, ENROLLMENT_STATUS.COMPLETED] },
    },
  });
  if (activeExisting) {
    throw ApiError.conflict(
      'ALREADY_ENROLLED',
      quote.teamId
        ? 'You are already enrolled with this team.'
        : 'You already have an active enrollment for this plan.',
    );
  }

  // Reuse existing unpaid enrollment if one exists
  const unpaid = await prisma.enrollment.findFirst({
    where: {
      userId: req.user.id,
      planId: quote.planId,
      teamId: quote.teamId || null,
      status: ENROLLMENT_STATUS.PENDING_PAYMENT,
    },
    orderBy: { createdAt: 'desc' },
  });

  const priceSnapshot = {
    basePrice: quote.basePrice,
    discountPercent: quote.discountPercent,
    payableAmount: quote.payableAmount,
    currency: quote.currency || 'INR',
  };

  if (unpaid) {
    const updated = await prisma.enrollment.update({
      where: { id: unpaid.id },
      data: { quoteId: quote.id, priceSnapshot },
    });
    return created(res, enrollmentDto(updated, null, null, quote.plan, null, null));
  }

  // Find latest published generic schedule template (exclude project-specific templates)
  const template = await prisma.scheduleTemplate.findFirst({
    where: {
      designationId: quote.plan.designationId,
      domainId: quote.plan.domainId,
      durationMonths: quote.plan.durationMonths,
      projectId: null,
      status: SCHEDULE_STATUS.PUBLISHED,
    },
    orderBy: { version: 'desc' },
  });

  const enrollment = await prisma.enrollment.create({
    data: {
      userId: req.user.id,
      teamId: quote.teamId || null,
      planId: quote.planId,
      quoteId: quote.id,
      enrollmentType: quote.enrollmentType,
      scheduleTemplateId: template ? template.id : null,
      scheduleVersion: template ? template.version : null,
      priceSnapshot,
      track: normalizedTrack,
      status: ENROLLMENT_STATUS.PENDING_PAYMENT,
    },
  });

  created(res, enrollmentDto(enrollment, null, null, quote.plan, null, null));
});

const listMyEnrollments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
  const status = req.query.status;

  const where = {
    userId: req.user.id,
    ...(status && { status }),
  };

  const total = await prisma.enrollment.count({ where });
  const enrollments = await prisma.enrollment.findMany({
    where,
    include: {
      plan: { include: { designation: true, domain: true } },
      project: { include: { domain: true } },
      team: {
        include: {
          trainerAssignments: {
            where: { active: true },
            include: {
              trainer: {
                include: { trainerProfile: true },
              },
            },
          },
        },
      },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      certificate: true,
      taskProgress: true,
      trainerAssignments: {
        where: { active: true },
        include: {
          trainer: {
            include: { trainerProfile: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  // Load shared team TaskProgress for any team enrollments
  const teamIds = [...new Set(enrollments.map((e) => e.teamId).filter(Boolean))];
  const teamProgressMap = new Map();
  if (teamIds.length > 0) {
    const teamProgress = await prisma.taskProgress.findMany({
      where: { teamId: { in: teamIds } },
    });
    teamProgress.forEach((p) => {
      const list = teamProgressMap.get(p.teamId) || [];
      list.push(p);
      teamProgressMap.set(p.teamId, list);
    });
  }

  const items = enrollments.map((e) => {
    const latestPayment = e.payments[0] || null;
    const scopeProgress = e.teamId ? (teamProgressMap.get(e.teamId) || []) : e.taskProgress;
    const progressCount = {
      approved: scopeProgress.filter((p) => p.status === TASK_STATUS.APPROVED).length,
      total: scopeProgress.length,
    };
    return enrollmentDto(e, latestPayment, e.team, e.plan, progressCount, e.certificate);
  });

  ok(res, paginatedResponse(items, total, page, limit));
});

const getEnrollmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    include: {
      plan: { include: { designation: true, domain: true } },
      project: { include: { domain: true } },
      team: {
        include: {
          members: true,
          trainerAssignments: {
            where: { active: true },
            include: {
              trainer: {
                include: { trainerProfile: true },
              },
            },
          },
        },
      },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      certificate: true,
      taskProgress: true,
      trainerAssignments: {
        where: { active: true },
        include: {
          trainer: {
            include: { trainerProfile: true },
          },
        },
      },
    },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found.');

  const isOwner = enrollment.userId === req.user.id;
  const isTeamMember = enrollment.team?.members.some((m) => m.userId === req.user.id);
  if (!isOwner && !isTeamMember && !req.user.roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', 'You can only view your own enrollments.');
  }

  const latestPayment = enrollment.payments[0] || null;
  const scopeProgress = enrollment.teamId
    ? await prisma.taskProgress.findMany({ where: { teamId: enrollment.teamId } })
    : enrollment.taskProgress;
  const progressCount = {
    approved: scopeProgress.filter((p) => p.status === TASK_STATUS.APPROVED).length,
    total: scopeProgress.length,
  };

  ok(res, enrollmentDto(enrollment, latestPayment, enrollment.team, enrollment.plan, progressCount, enrollment.certificate));
});

// ─── Payment Handlers ────────────────────────────────────────────────────────

const createPaymentOrder = asyncHandler(async (req, res) => {
  const { enrollmentId } = req.body;
  if (!enrollmentId) {
    throw ApiError.validationError([{ field: 'enrollmentId', message: 'Enrollment is required.' }]);
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: String(enrollmentId).trim() },
    include: { plan: { include: { designation: true, domain: true } } },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found.');
  if (enrollment.userId !== req.user.id) {
    throw ApiError.forbidden('FORBIDDEN', 'You can only pay for your own enrollments.');
  }

  // SD3: Unverified users cannot pay
  if (!req.user.emailVerified) {
    throw ApiError.forbidden('EMAIL_NOT_VERIFIED', 'Verify your email address before paying.');
  }

  // SD5: Must accept latest terms
  const latestTerms = await prisma.termsVersion.findFirst({
    orderBy: { version: 'desc' },
  });
  if (latestTerms) {
    const acceptance = await prisma.termsAcceptance.findFirst({
      where: {
        enrollmentId: enrollment.id,
        termsVersion: latestTerms.version,
      },
    });
    if (!acceptance) {
      throw ApiError.unprocessable(
        'TERMS_NOT_ACCEPTED',
        'Accept the latest terms and conditions before paying.',
      );
    }
  }

  if (enrollment.status !== ENROLLMENT_STATUS.PENDING_PAYMENT) {
    throw ApiError.conflict('ALREADY_PAID', 'This enrollment has already been paid.');
  }

  const snapshot = enrollment.priceSnapshot || {};
  const amount = Number(snapshot.payableAmount);
  const currency = snapshot.currency || 'INR';

  const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const payment = await prisma.payment.create({
    data: {
      enrollmentId: enrollment.id,
      userId: req.user.id,
      orderId,
      provider: 'mock',
      amount,
      currency,
      status: PAYMENT_STATUS.CREATED,
    },
  });

  await prisma.paymentEvent.create({
    data: {
      paymentId: payment.id,
      eventId: `${orderId}_created`,
      type: 'payment.created',
      payload: { orderId, amount, currency },
    },
  });

  const desigName = enrollment.plan?.designation?.name || 'Internship';
  const duration = enrollment.plan?.durationMonths || 1;

  created(res, {
    paymentId: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    checkoutData: {
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      merchantName: 'Innov8 Internship Portal',
      description: `${desigName} - ${duration} Months`,
      prefill: { name: req.user.name, email: req.user.email },
    },
  });
});

/**
 * Safe, non-blocking notification to all active admins when a student enrollment becomes active.
 */
async function notifyAdminsNewEnrollment({
  enrollmentId,
  studentId,
  studentName,
  studentEmail,
  domainName,
  projectTitle,
}) {
  try {
    const label = studentName || studentEmail || 'A new student';
    const scope = [domainName, projectTitle].filter(Boolean).join(' — ');
    await notifyAdmins({
      type: 'NEW_STUDENT_ENROLLED',
      title: 'New Student Enrolled — Assign Trainer',
      message: scope
        ? `${label} enrolled in ${scope}. Please assign a trainer.`
        : `${label} enrolled in an internship. Please assign a trainer.`,
      link: '/admin/users',
      metadata: {
        enrollmentId,
        studentId,
        domainName: domainName || null,
        projectTitle: projectTitle || null,
      },
    });
  } catch (err) {
    logger.warn(`[Enrollment] Admin notification failed for enrollment ${enrollmentId}: ${err.message}`);
  }
}

async function activateEnrollmentEngine(enrollmentId) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { plan: true, user: true },
  });
  if (!enrollment || enrollment.status !== ENROLLMENT_STATUS.PENDING_PAYMENT) return enrollment;

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
        projectId: null,
        status: SCHEDULE_STATUS.PUBLISHED,
      },
      orderBy: { version: 'desc' },
    });
  }

  const updatedEnrollment = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: ENROLLMENT_STATUS.ACTIVE,
      paymentStatus: PAYMENT_STATUS.SUCCESS,
      activatedAt: new Date(),
      scheduleTemplateId: template ? template.id : enrollment.scheduleTemplateId,
      scheduleVersion: template ? template.version : enrollment.scheduleVersion,
    },
  });

  await notifyAdminsNewEnrollment({
    enrollmentId: updatedEnrollment.id,
    studentId: enrollment.userId,
    studentName: enrollment.user?.name,
    studentEmail: enrollment.user?.email,
  });

  // For team enrollments, only activate the team and seed shared tasks once readiness is met
  let shouldSeedTasks = true;
  if (enrollment.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: enrollment.teamId },
      include: { members: { include: { user: true } }, plan: true },
    });
    if (team) {
      const readiness = await computeTeamReadiness(team);
      if (readiness.ready) {
        await prisma.team.update({
          where: { id: enrollment.teamId },
          data: { status: TEAM_STATUS.ACTIVE },
        });
      } else {
        shouldSeedTasks = false;
      }
    }
  }

  // Create progress records for tasks (deduplicating by teamId for team enrollments)
  // Note: Projects are manually assigned by Admin via /admin/project-assignments (no auto-assign).
  if (template && shouldSeedTasks) {
    const tasks = await prisma.taskDefinition.findMany({
      where: { templateId: template.id },
      orderBy: { sequence: 'asc' },
    });

    const templateTaskIds = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      let prerequisites = [];
      if (task.prerequisiteTaskIds) {
        prerequisites = Array.isArray(task.prerequisiteTaskIds)
          ? task.prerequisiteTaskIds
          : JSON.parse(task.prerequisiteTaskIds || '[]');
      }
      const validPrereqs = prerequisites.filter((pid) => templateTaskIds.has(pid));
      const initialStatus = validPrereqs.length > 0 ? TASK_STATUS.LOCKED : TASK_STATUS.AVAILABLE;

      const existingProgress = await prisma.taskProgress.findFirst({
        where: enrollment.teamId
          ? { teamId: enrollment.teamId, taskId: task.id }
          : { enrollmentId: enrollment.id, taskId: task.id },
      });

      if (!existingProgress) {
        await prisma.taskProgress.create({
          data: {
            enrollmentId: enrollment.id,
            teamId: enrollment.teamId || null,
            taskId: task.id,
            status: initialStatus,
          },
        });
      }
    }
  }

  // Alert admins that a new paid enrollment needs manual project & trainer assignment
  await notifyAdmins({
    type: 'ENROLLMENT_NEEDS_ALLOCATION',
    title: `New active enrollment: ${enrollment.user?.name || 'Student'}`,
    message: `${enrollment.user?.name || 'A student'} completed payment. Assign their capstone project and mentor.`,
    link: '/admin/project-assignments',
    metadata: { enrollmentId: enrollment.id, userId: enrollment.userId },
  });

  // Queue / Send payment success email
  if (enrollment.user) {
    try {
      const snap = enrollment.priceSnapshot || {};
      await sendPaymentSuccessEmail(
        enrollment.user.email,
        enrollment.user.name,
        enrollment.id,
        snap.payableAmount ? (snap.payableAmount / 100).toFixed(2) : '0',
      );
    } catch (err) {
      logger.warn('Failed to send payment success email:', err.message);
    }
  }

  return updatedEnrollment;
}

const completeMockPayment = asyncHandler(async (req, res) => {
  const { orderId, outcome } = req.body;
  const normalizedOutcome = String(outcome || '').trim().toLowerCase();

  const details = [];
  if (!orderId) details.push({ field: 'orderId', message: 'Order id is required.' });
  if (!['success', 'failure', 'pending'].includes(normalizedOutcome)) {
    details.push({ field: 'outcome', message: 'Outcome must be success, failure or pending.' });
  }
  if (details.length > 0) throw ApiError.validationError(details);

  const payment = await prisma.payment.findUnique({
    where: { orderId: String(orderId).trim() },
    include: { enrollment: true },
  });

  if (!payment) throw ApiError.notFound('Payment order not found.');
  if (payment.userId !== req.user.id) {
    throw ApiError.forbidden('FORBIDDEN', 'You can only complete your own payments.');
  }

  // Idempotency: if already SUCCESS, return status
  if (payment.status === PAYMENT_STATUS.SUCCESS) {
    return ok(res, { status: payment.status });
  }

  const eventId = `evt_${Date.now()}`;

  if (normalizedOutcome === 'failure') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PAYMENT_STATUS.FAILED },
    });
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventId,
        type: 'payment.failed',
        note: 'Payment declined by mock gateway.',
      },
    });
    return ok(res, { status: PAYMENT_STATUS.FAILED });
  }

  if (normalizedOutcome === 'pending') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PAYMENT_STATUS.PENDING },
    });
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventId,
        type: 'payment.pending',
        note: 'Payment pending mock settlement.',
      },
    });
    return ok(res, { status: PAYMENT_STATUS.PENDING });
  }

  // Outcome === 'success'
  const gatewayRef = `pay_mock_${Math.random().toString(36).substring(2, 10)}`;
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: PAYMENT_STATUS.SUCCESS,
      gatewayReference: gatewayRef,
    },
  });

  await prisma.paymentEvent.create({
    data: {
      paymentId: payment.id,
      eventId: `${eventId}_captured`,
      type: 'payment.captured',
      payload: { gatewayReference: gatewayRef },
    },
  });

  await activateEnrollmentEngine(payment.enrollmentId);

  try {
    await recordTpoEarningForPayment(prisma, {
      enrollmentId: payment.enrollmentId,
      paymentId: payment.id,
      studentId: payment.userId,
      paymentAmountPaise: payment.amount,
      currency: payment.currency || 'INR',
    });
  } catch (err) {
    logger.warn(`[TPO] Failed to record earning for payment ${payment.id}: ${err.message}`);
  }

  ok(res, { status: PAYMENT_STATUS.SUCCESS });
});

const completeDemoCheckout = asyncHandler(async (req, res) => {
  const {
    fullName,
    email,
    phone,
    college,
    domainName,
    duration,
    durationMonths: rawDurationMonths,
    projectId,
    projectTitle,
    amount: rawAmount,
    track,
    referralCode,
    internshipId,
    companyName,
    designationName,
  } = req.body;

  if (!email || !String(email).trim()) {
    throw ApiError.badRequest('EMAIL_REQUIRED', 'Email address is required for demo checkout.');
  }

  // Validate optional TPO referral code before creating enrollment or payment
  let referredTpo = null;
  const normalizedCode = normalizeReferralCode(referralCode);
  if (normalizedCode) {
    referredTpo = await prisma.tpo.findUnique({
      where: { referralCode: normalizedCode },
      select: {
        id: true,
        name: true,
        college: true,
        referralCode: true,
        isActive: true,
      },
    });
    if (!referredTpo || !referredTpo.isActive) {
      throw ApiError.validationError([
        {
          field: 'referralCode',
          message: 'Invalid or inactive TPO reference code. Please double-check with your TPO.',
        },
      ]);
    }
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(fullName || cleanEmail.split('@')[0] || 'Student').trim();

  // 1. Resolve or create user
  let user = null;
  if (req.user?.id) {
    user = await prisma.user.findUnique({ where: { id: req.user.id } });
  }
  if (!user) {
    user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  }

  if (!user) {
    let studentRole = await prisma.roleModel.findUnique({ where: { name: ROLES.STUDENT } });
    if (!studentRole) {
      studentRole = await prisma.roleModel.findFirst({ where: { name: 'STUDENT' } });
    }
    const pwdHash = await hashPassword('DemoStudent123!');
    user = await prisma.user.create({
      data: {
        name: cleanName,
        email: cleanEmail,
        phone: phone ? String(phone).trim() : null,
        college: college ? String(college).trim() : null,
        passwordHash: pwdHash,
        status: 'ACTIVE',
        emailVerified: true,
        referredByTpoId: referredTpo?.id || null,
        referralCodeUsed: referredTpo?.referralCode || null,
        ...(studentRole && {
          userRoles: {
            create: { roleId: studentRole.id },
          },
        }),
      },
    });
  } else {
    const updateData = {};
    if (cleanName && (!user.name || user.name === user.email)) updateData.name = cleanName;
    if (phone && !user.phone) updateData.phone = String(phone).trim();
    if (college && !user.college) updateData.college = String(college).trim();
    if (referredTpo && !user.referredByTpoId) {
      updateData.referredByTpoId = referredTpo.id;
      updateData.referralCodeUsed = referredTpo.referralCode;
    }
    if (Object.keys(updateData).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }
  }

  // 2. Resolve Domain
  let domain = null;
  if (domainName) {
    domain = await prisma.domain.findFirst({
      where: {
        OR: [
          { name: { equals: String(domainName).trim(), mode: 'insensitive' } },
          { slug: { equals: String(domainName).trim().toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });
  }
  if (!domain) {
    domain = await prisma.domain.findFirst();
  }

  // 3. Resolve Duration Months
  let durMonths = Number(rawDurationMonths);
  if (!durMonths || Number.isNaN(durMonths)) {
    const matched = String(duration || '').match(/\d+/);
    durMonths = matched ? parseInt(matched[0], 10) : 3;
  }

  // 4. Resolve Designation name from partner position or request body
  let resolvedDesignationName = designationName || null;
  if (!resolvedDesignationName && internshipId) {
    const pos = InternshipsModel.findPositionById(internshipId);
    if (pos?.role?.designation) {
      resolvedDesignationName = pos.role.designation;
    }
  }

  // 5. Resolve Plan — filter by designation + domain + duration
  let plan = null;
  let designation = null;
  let cleanDesigName = null;

  if (resolvedDesignationName) {
    // Strip track suffix like " – Web Development" to match DB designation name
    cleanDesigName = String(resolvedDesignationName)
      .replace(/\s*[–-]\s*(Web|App)\s*Development\s*$/i, '')
      .trim();

    designation = await prisma.designation.findFirst({
      where: {
        OR: [
          { name: { equals: cleanDesigName, mode: 'insensitive' } },
          { name: { equals: String(resolvedDesignationName).trim(), mode: 'insensitive' } },
          { slug: { equals: cleanDesigName.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
        ],
      },
    });

    if (!designation && cleanDesigName) {
      const desigSlug = cleanDesigName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      designation = await prisma.designation.create({
        data: {
          name: cleanDesigName,
          slug: desigSlug || `role-${Date.now()}`,
          description: `${cleanDesigName} Role`,
          status: 'PUBLISHED',
        },
      });
    }
  }

  if (designation && domain) {
    plan = await prisma.internshipPlan.findFirst({
      where: {
        designationId: designation.id,
        domainId: domain.id,
        durationMonths: durMonths,
      },
    });
    if (!plan) {
      // No plan exists for this designation + domain + duration — create one
      // so the student gets the correct designation on their dashboard
      const refPlan = await prisma.internshipPlan.findFirst({
        where: { domainId: domain.id, durationMonths: durMonths },
      });
      plan = await prisma.internshipPlan.create({
        data: {
          designationId: designation.id,
          domainId: domain.id,
          durationMonths: durMonths,
          basePrice: refPlan?.basePrice ?? (rawAmount ? Number(rawAmount) : 169900),
          currency: refPlan?.currency ?? 'INR',
          status: 'PUBLISHED',
        },
      });
    }
  }

  // Fallback: no designation was resolved — pick any plan matching domain + duration (legacy behavior)
  if (!plan && !designation && domain) {
    plan = await prisma.internshipPlan.findFirst({
      where: { domainId: domain.id, durationMonths: durMonths },
    });
    if (!plan) {
      plan = await prisma.internshipPlan.findFirst({
        where: { domainId: domain.id },
      });
    }
  }
  if (!plan && !designation) {
    plan = await prisma.internshipPlan.findFirst();
  }

  if (!plan && domain) {
    if (!designation) {
      designation = await prisma.designation.findFirst();
    }
    if (!designation) {
      designation = await prisma.designation.create({
        data: {
          name: 'Software Engineer',
          slug: 'software-engineer',
          description: 'Software Engineer Role',
          status: 'PUBLISHED',
        },
      });
    }
    plan = await prisma.internshipPlan.create({
      data: {
        designationId: designation.id,
        domainId: domain.id,
        durationMonths: durMonths,
        basePrice: 169900,
        currency: 'INR',
        status: 'PUBLISHED',
      },
    });
  }

  // 6. Resolve Project
  let project = null;
  if (projectId) {
    project = await prisma.project.findFirst({
      where: {
        OR: [
          { id: String(projectId).trim() },
          { slug: String(projectId).trim().toLowerCase() },
        ],
      },
    });
  }
  if (!project && projectTitle) {
    project = await prisma.project.findFirst({
      where: {
        title: { equals: String(projectTitle).trim(), mode: 'insensitive' },
      },
    });
  }
  if (!project && domain) {
    project = await prisma.project.findFirst({
      where: { domainId: domain.id },
      orderBy: { isDefault: 'desc' },
    });
  }

  // 7. Resolve Amount (paise) from partner internship pricing if available, fallback to rawAmount / default
  const resolvedQuote =
    internshipId || companyName
      ? InternshipsService.getQuote({
        internshipId,
        companyName,
        domainName: domain?.name || domainName,
        projectId: project?.id || projectId,
        projectTitle: project?.title || projectTitle,
        projectSlug: project?.slug,
        durationMonths: durMonths,
      })
      : null;
  const amount =
    resolvedQuote && Number.isFinite(resolvedQuote.payablePaise)
      ? resolvedQuote.payablePaise
      : rawAmount
        ? Number(rawAmount)
        : 169900;

  // 8. Create Enrollment
  const enrollment = await prisma.enrollment.create({
    data: {
      userId: user.id,
      planId: plan.id,
      projectId: project ? project.id : null,
      track: String(track || 'web').toLowerCase() === 'app' ? 'app' : 'web',
      status: ENROLLMENT_STATUS.ACTIVE,
      paymentStatus: PAYMENT_STATUS.SUCCESS,
      activatedAt: new Date(),
      projectAssignedAt: project ? new Date() : null,
      priceSnapshot: {
        amount,
        currency: 'INR',
        discount: 0,
        payableAmount: amount,
        designationName: cleanDesigName || resolvedDesignationName || designation?.name || null,
        companyName: companyName || null,
        internshipId: internshipId || null,
        ...(referredTpo ? { referralCode: referredTpo.referralCode, tpoId: referredTpo.id } : {}),
      },
    },
  });

  // 9. Create Payment
  const orderId = `DEMO-TXN-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const payment = await prisma.payment.create({
    data: {
      enrollmentId: enrollment.id,
      userId: user.id,
      orderId,
      provider: 'demo',
      amount,
      currency: 'INR',
      status: PAYMENT_STATUS.SUCCESS,
      gatewayReference: `pay_demo_${Math.random().toString(36).substring(2, 10)}`,
      events: {
        create: {
          eventId: `evt_demo_${Date.now()}`,
          type: 'payment.captured',
          note: 'Demo payment completed directly in student modal.',
        },
      },
    },
  });

  // 9. Idempotently credit TPO earning ledger if referred (never exposed to student response)
  try {
    await recordTpoEarningForPayment(prisma, {
      enrollmentId: enrollment.id,
      paymentId: payment.id,
      studentId: user.id,
      paymentAmountPaise: payment.amount,
      currency: payment.currency || 'INR',
      explicitTpoId: referredTpo?.id || user.referredByTpoId || null,
      explicitReferralCode: referredTpo?.referralCode || user.referralCodeUsed || null,
    });
  } catch (err) {
    logger.warn(`[TPO] Failed to record earning for demo payment ${payment.id}: ${err.message}`);
  }

  // 10. Sync assigned project tasks & notify admins
  if (project) {
    try {
      await syncProjectTasksToEnrollment(enrollment.id, project, {
        actorId: user.id,
        track: enrollment.track,
      });
    } catch (err) {
      logger.warn(`[DemoCheckout] Failed to sync tasks for enrollment ${enrollment.id}: ${err.message}`);
    }
  }

  await notifyAdminsNewEnrollment({
    enrollmentId: enrollment.id,
    studentId: user.id,
    studentName: user.name,
    studentEmail: user.email,
    domainName: domain?.name,
    projectTitle: project?.title,
  });
  created(res, {
    success: true,
    enrollmentId: enrollment.id,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    studentName: user.name,
    studentEmail: user.email,
    domainName: domain?.name,
    projectTitle: project?.title,
    durationMonths: durMonths,
    referralCodeUsed: referredTpo?.referralCode || user.referralCodeUsed || null,
    tpoName: referredTpo?.name || null,
  });
});

const handlePaymentWebhook = asyncHandler(async (_req, res) => {
  ok(res, { received: true });
});

module.exports = {
  getLatestTerms,
  acceptTerms,
  createQuote,
  createEnrollment,
  listMyEnrollments,
  getEnrollmentById,
  createPaymentOrder,
  completeMockPayment,
  completeDemoCheckout,
  handlePaymentWebhook,
  activateEnrollmentEngine,
  submitChangeTrainerRequest,
};
