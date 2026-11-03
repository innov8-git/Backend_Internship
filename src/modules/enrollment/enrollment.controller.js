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
  USER_STATUS,
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
const logger = require('../../libs/logger');

const QUOTE_TTL_HOURS = 24;

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

function quoteDto(quote) {
  if (!quote) return null;
  return {
    _id: quote.id,
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
  return {
    _id: enrollment.id,
    userId: enrollment.userId,
    teamId: enrollment.teamId || null,
    team: team ? { _id: team.id, name: team.name } : null,
    planId: enrollment.planId,
    plan: planRef(plan),
    quoteId: enrollment.quoteId || null,
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

  // Check student assessment attempt
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: {
      userId_designationId: {
        userId: req.user.id,
        designationId: plan.designationId,
      },
    },
  });

  if (!attempt) {
    throw ApiError.unprocessable(
      'ASSESSMENT_REQUIRED',
      'Take the assessment before getting a quote.',
      [{ field: 'planId', message: 'Take the assessment before getting a quote.' }],
    );
  }

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

  // Team quote discount is always 0%
  const discountPercent = team ? 0 : Number(attempt.discountPercent) || 0;
  const payableAmount = Math.round(plan.basePrice * (1 - discountPercent / 100));
  const expiresAt = new Date(Date.now() + QUOTE_TTL_HOURS * 60 * 60 * 1000);

  const quote = await prisma.quote.create({
    data: {
      userId: req.user.id,
      planId: plan.id,
      enrollmentType: team ? ENROLLMENT_TYPE.TEAM : ENROLLMENT_TYPE.INDIVIDUAL,
      teamId: team ? team.id : null,
      attemptId: attempt.id,
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
  const { quoteId } = req.body;
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

  // Find latest published schedule template
  const template = await prisma.scheduleTemplate.findFirst({
    where: {
      designationId: quote.plan.designationId,
      domainId: quote.plan.domainId,
      durationMonths: quote.plan.durationMonths,
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
      team: true,
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      certificate: true,
      taskProgress: true,
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const items = enrollments.map((e) => {
    const latestPayment = e.payments[0] || null;
    const progressCount = {
      approved: e.taskProgress.filter((p) => p.status === TASK_STATUS.APPROVED).length,
      total: e.taskProgress.length,
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
      team: { include: { members: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      certificate: true,
      taskProgress: true,
    },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found.');

  const isOwner = enrollment.userId === req.user.id;
  const isTeamMember = enrollment.team?.members.some((m) => m.userId === req.user.id);
  if (!isOwner && !isTeamMember && !req.user.roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('FORBIDDEN', 'You can only view your own enrollments.');
  }

  const latestPayment = enrollment.payments[0] || null;
  const progressCount = {
    approved: enrollment.taskProgress.filter((p) => p.status === TASK_STATUS.APPROVED).length,
    total: enrollment.taskProgress.length,
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

  // Create progress records for tasks
  if (template) {
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
        where: {
          enrollmentId: enrollment.id,
          taskId: task.id,
        },
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

  // If team enrollment, check and activate team
  if (enrollment.teamId) {
    await prisma.team.update({
      where: { id: enrollment.teamId },
      data: { status: TEAM_STATUS.ACTIVE },
    });
  }

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

  ok(res, { status: PAYMENT_STATUS.SUCCESS });
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
  handlePaymentWebhook,
  activateEnrollmentEngine,
};
