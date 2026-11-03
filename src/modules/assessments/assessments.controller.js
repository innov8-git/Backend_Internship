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
  PUBLISH_STATUS,
  SCHEDULE_STATUS,
  ASSESSMENT_QUESTION_COUNT,
  ASSESSMENT_OPTION_COUNT,
} = require('../../common/constants');

const ALREADY_ATTEMPTED_MESSAGE =
  'You have already taken this assessment. Each assessment can be taken once.';

function attemptDto(attempt, designation = null) {
  if (!attempt) return null;
  const desig = designation || attempt.designation;
  return {
    _id: attempt.id,
    designationId: attempt.designationId,
    configVersion: attempt.configVersion ?? null,
    score: Number(attempt.score) || 0,
    totalQuestions: attempt.totalQuestions ?? ASSESSMENT_QUESTION_COUNT,
    discountPercent: Number(attempt.discountPercent) || 0,
    submittedAt: attempt.submittedAt ?? null,
    designation: desig ? { _id: desig.id, name: desig.name, slug: desig.slug } : null,
  };
}

function discountForScore(slabs, score) {
  const value = Number(score);
  const list = Array.isArray(slabs) ? slabs : JSON.parse(slabs || '[]');
  const slab = list.find(
    (candidate) =>
      candidate && value >= Number(candidate.minScore) && value <= Number(candidate.maxScore),
  );
  return slab ? Number(slab.discountPercent) || 0 : 0;
}

function scoreAnswers(questions, answers) {
  const selected = new Map();
  (Array.isArray(answers) ? answers : []).forEach((a) => {
    if (a && a.questionId !== undefined && a.questionId !== null) {
      selected.set(String(a.questionId), a.selectedIndex);
    }
  });

  const lastOption = ASSESSMENT_OPTION_COUNT - 1;
  const score = questions.reduce((total, q) => {
    const choice = selected.get(String(q._id));
    const correct =
      Number.isInteger(choice) &&
      choice >= 0 &&
      choice <= lastOption &&
      Number.isInteger(q.correctIndex) &&
      choice === q.correctIndex;
    if (!correct) return total;
    const marks = Number(q.marks);
    return total + (Number.isFinite(marks) && marks > 0 ? marks : 1);
  }, 0);

  return Math.max(0, Math.min(ASSESSMENT_QUESTION_COUNT, score));
}

async function resolvePublishedAssessment(idOrSlug) {
  const designation = await prisma.designation.findFirst({
    where: {
      status: PUBLISH_STATUS.PUBLISHED,
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
  });

  if (!designation) return null;

  const config = await prisma.assessmentConfig.findFirst({
    where: {
      designationId: designation.id,
      status: SCHEDULE_STATUS.PUBLISHED,
    },
    orderBy: { version: 'desc' },
  });

  if (!config) return null;

  const questions = Array.isArray(config.questions)
    ? config.questions
    : JSON.parse(config.questions || '[]');

  if (questions.length === 0) return null;

  const discountSlabs = Array.isArray(config.discountSlabs)
    ? config.discountSlabs
    : JSON.parse(config.discountSlabs || '[]');

  return { designation, config, questions, discountSlabs };
}

function validateAnswers(rawAnswers, questions) {
  if (!Array.isArray(rawAnswers)) {
    return { answers: [], details: [{ field: 'answers', message: 'Answers must be a list.' }] };
  }

  const optionCounts = new Map(
    questions.map((q) => [
      String(q._id),
      Array.isArray(q.options) ? q.options.length : ASSESSMENT_OPTION_COUNT,
    ]),
  );

  if (rawAnswers.length > optionCounts.size) {
    return {
      answers: [],
      details: [{ field: 'answers', message: 'There are more answers than questions.' }],
    };
  }

  const details = [];
  const answers = [];
  const seen = new Set();

  rawAnswers.forEach((entry, idx) => {
    const field = `answers.${idx}`;
    if (!entry || typeof entry !== 'object') {
      details.push({ field, message: 'Each answer needs a questionId and a selectedIndex.' });
      return;
    }
    const { questionId, selectedIndex } = entry;
    const qIdStr = String(questionId);
    if (!questionId || !optionCounts.has(qIdStr)) {
      details.push({ field: `${field}.questionId`, message: 'This question is not part of the assessment.' });
      return;
    }
    if (seen.has(qIdStr)) {
      details.push({ field: `${field}.questionId`, message: 'Each question can be answered once.' });
      return;
    }
    seen.add(qIdStr);

    if (selectedIndex === null || selectedIndex === undefined) return;

    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= optionCounts.get(qIdStr)
    ) {
      details.push({ field: `${field}.selectedIndex`, message: 'Choose one of the options.' });
      return;
    }
    answers.push({ questionId: qIdStr, selectedIndex });
  });

  return { answers, details };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * GET /assessments/attempts/mine
 */
const getMyAttempts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);

  const [total, attempts] = await Promise.all([
    prisma.assessmentAttempt.count({ where: { userId: req.user.id } }),
    prisma.assessmentAttempt.findMany({
      where: { userId: req.user.id },
      orderBy: { submittedAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  // Load designations for each attempt
  const desigIds = [...new Set(attempts.map((a) => a.designationId))];
  const designations = await prisma.designation.findMany({
    where: { id: { in: desigIds } },
  });
  const desigMap = new Map(designations.map((d) => [d.id, d]));

  const items = attempts.map((a) => attemptDto(a, desigMap.get(a.designationId)));
  ok(res, paginatedResponse(items, total, page, limit));
});

/**
 * GET /assessments/:designationId/attempt
 */
const getMyAttemptForDesignation = asyncHandler(async (req, res) => {
  const { designationId } = req.params;

  const designation = await prisma.designation.findFirst({
    where: {
      OR: [{ id: designationId }, { slug: designationId }],
    },
  });

  const desigId = designation ? designation.id : designationId;

  const attempt = await prisma.assessmentAttempt.findUnique({
    where: {
      userId_designationId: {
        userId: req.user.id,
        designationId: desigId,
      },
    },
  });

  if (!attempt) {
    throw ApiError.notFound('Attempt not found.');
  }

  ok(res, attemptDto(attempt, designation));
});

/**
 * GET /assessments/:designationId
 */
const getAssessment = asyncHandler(async (req, res) => {
  const { designationId } = req.params;

  const resolved = await resolvePublishedAssessment(designationId);
  if (!resolved) {
    throw ApiError.notFound('Assessment not found.');
  }

  const { designation, config, questions } = resolved;

  // Check if student already attempted
  const existing = await prisma.assessmentAttempt.findUnique({
    where: {
      userId_designationId: {
        userId: req.user.id,
        designationId: designation.id,
      },
    },
  });

  if (existing) {
    throw ApiError.conflict('ALREADY_ATTEMPTED', ALREADY_ATTEMPTED_MESSAGE);
  }

  // Student view: Strip correctIndex and marks
  ok(res, {
    designation: { _id: designation.id, name: designation.name, slug: designation.slug },
    configVersion: config.version,
    totalQuestions: questions.length,
    questions: questions.map((q) => ({
      _id: q._id,
      text: q.text,
      options: Array.isArray(q.options) ? [...q.options] : [],
    })),
  });
});

/**
 * POST /assessments/:designationId/submit
 */
const submitAssessment = asyncHandler(async (req, res) => {
  const { designationId } = req.params;

  const resolved = await resolvePublishedAssessment(designationId);
  if (!resolved) {
    throw ApiError.notFound('Assessment not found.');
  }

  const { designation, config, questions, discountSlabs } = resolved;

  // Check if student already attempted
  const existing = await prisma.assessmentAttempt.findUnique({
    where: {
      userId_designationId: {
        userId: req.user.id,
        designationId: designation.id,
      },
    },
  });

  if (existing) {
    throw ApiError.conflict('ALREADY_ATTEMPTED', ALREADY_ATTEMPTED_MESSAGE);
  }

  const { answers, details } = validateAnswers(req.body?.answers, questions);
  if (details.length > 0) {
    throw ApiError.validationError(details);
  }

  const score = scoreAnswers(questions, answers);
  const discountPercent = discountForScore(discountSlabs, score);

  const attempt = await prisma.assessmentAttempt.create({
    data: {
      userId: req.user.id,
      designationId: designation.id,
      configVersion: config.version,
      score,
      totalQuestions: ASSESSMENT_QUESTION_COUNT,
      discountPercent,
    },
  });

  created(res, attemptDto(attempt, designation));
});

module.exports = {
  getMyAttempts,
  getMyAttemptForDesignation,
  getAssessment,
  submitAssessment,
  discountForScore,
  attemptDto,
};
