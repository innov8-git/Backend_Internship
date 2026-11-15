'use strict';

const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  created,
  parsePagination,
  paginatedResponse,
} = require('../../utils');
const { addAudit } = require('../audit-log/audit-log.service');

function questionDto(q) {
  if (!q) return null;
  return {
    _id: q.id,
    domainId: q.domainId,
    text: q.text,
    options: Array.isArray(q.options) ? q.options : [],
    correctIndex: q.correctIndex,
    explanation: q.explanation || '',
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

async function resolveDomain(domainIdOrSlug) {
  const domain = await prisma.domain.findFirst({
    where: {
      OR: [{ id: domainIdOrSlug }, { slug: domainIdOrSlug }],
    },
  });
  if (!domain) {
    throw ApiError.notFound('Domain not found.');
  }
  return domain;
}

/**
 * GET /api/v1/admin/domains/:domainId/questions
 */
const listDomainQuestions = asyncHandler(async (req, res) => {
  const domain = await resolveDomain(req.params.domainId);
  const { page, limit, skip } = parsePagination(req.query, 15);
  const { search } = req.query;

  const where = {
    domainId: domain.id,
    ...(search && {
      text: { contains: String(search), mode: 'insensitive' },
    }),
  };

  const [total, items] = await Promise.all([
    prisma.domainQuestion.count({ where }),
    prisma.domainQuestion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  const response = paginatedResponse(items.map(questionDto), total, page, limit);
  // Add totalQuestions alias for frontend compatibility
  response.totalQuestions = total;

  ok(res, response);
});

/**
 * POST /api/v1/admin/domains/:domainId/questions
 */
const createDomainQuestion = asyncHandler(async (req, res) => {
  const domain = await resolveDomain(req.params.domainId);
  const { text, options, correctIndex, explanation } = req.body;

  const details = [];
  const cleanText = typeof text === 'string' ? text.trim() : '';
  if (!cleanText || cleanText.length < 5) {
    details.push({ field: 'text', message: 'Question text must be at least 5 characters.' });
  }

  const cleanOptions = Array.isArray(options)
    ? options.map((opt) => (typeof opt === 'string' ? opt.trim() : ''))
    : [];

  if (cleanOptions.length !== 4 || cleanOptions.some((opt) => !opt)) {
    details.push({ field: 'options', message: 'All 4 options must be provided and non-empty.' });
  }

  const cIndex = Number(correctIndex);
  if (!Number.isInteger(cIndex) || cIndex < 0 || cIndex > 3) {
    details.push({ field: 'correctIndex', message: 'Correct option index must be between 0 and 3.' });
  }

  if (details.length > 0) {
    throw ApiError.validationError(details);
  }

  const currentCount = await prisma.domainQuestion.count({ where: { domainId: domain.id } });
  if (currentCount >= 100) {
    throw ApiError.badRequest('Domain question bank has reached maximum capacity of 100 questions.');
  }

  const question = await prisma.domainQuestion.create({
    data: {
      domainId: domain.id,
      text: cleanText,
      options: cleanOptions,
      correctIndex: cIndex,
      explanation: typeof explanation === 'string' ? explanation.trim() : '',
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'DOMAIN_QUESTION_CREATED',
    entityType: 'DomainQuestion',
    entityId: question.id,
    after: questionDto(question),
    ip: req.ip,
  });

  created(res, questionDto(question));
});

/**
 * PUT /api/v1/admin/domains/:domainId/questions/:questionId
 */
const updateDomainQuestion = asyncHandler(async (req, res) => {
  const domain = await resolveDomain(req.params.domainId);
  const { questionId } = req.params;

  const existing = await prisma.domainQuestion.findFirst({
    where: { id: questionId, domainId: domain.id },
  });

  if (!existing) {
    throw ApiError.notFound('Question not found in this domain.');
  }

  const { text, options, correctIndex, explanation } = req.body;
  const details = [];

  const cleanText = typeof text === 'string' ? text.trim() : existing.text;
  if (!cleanText || cleanText.length < 5) {
    details.push({ field: 'text', message: 'Question text must be at least 5 characters.' });
  }

  const cleanOptions = Array.isArray(options)
    ? options.map((opt) => (typeof opt === 'string' ? opt.trim() : ''))
    : existing.options;

  if (cleanOptions.length !== 4 || cleanOptions.some((opt) => !opt)) {
    details.push({ field: 'options', message: 'All 4 options must be provided and non-empty.' });
  }

  const cIndex = correctIndex !== undefined ? Number(correctIndex) : existing.correctIndex;
  if (!Number.isInteger(cIndex) || cIndex < 0 || cIndex > 3) {
    details.push({ field: 'correctIndex', message: 'Correct option index must be between 0 and 3.' });
  }

  if (details.length > 0) {
    throw ApiError.validationError(details);
  }

  const updated = await prisma.domainQuestion.update({
    where: { id: questionId },
    data: {
      text: cleanText,
      options: cleanOptions,
      correctIndex: cIndex,
      explanation: explanation !== undefined ? String(explanation).trim() : existing.explanation,
    },
  });

  await addAudit({
    actorId: req.user.id,
    action: 'DOMAIN_QUESTION_UPDATED',
    entityType: 'DomainQuestion',
    entityId: updated.id,
    before: questionDto(existing),
    after: questionDto(updated),
    ip: req.ip,
  });

  ok(res, questionDto(updated));
});

/**
 * DELETE /api/v1/admin/domains/:domainId/questions/:questionId
 */
const deleteDomainQuestion = asyncHandler(async (req, res) => {
  const domain = await resolveDomain(req.params.domainId);
  const { questionId } = req.params;

  const existing = await prisma.domainQuestion.findFirst({
    where: { id: questionId, domainId: domain.id },
  });

  if (!existing) {
    throw ApiError.notFound('Question not found in this domain.');
  }

  await prisma.domainQuestion.delete({ where: { id: questionId } });

  await addAudit({
    actorId: req.user.id,
    action: 'DOMAIN_QUESTION_DELETED',
    entityType: 'DomainQuestion',
    entityId: questionId,
    before: questionDto(existing),
    ip: req.ip,
  });

  ok(res, { success: true, message: 'Question deleted successfully.' });
});

module.exports = {
  questionDto,
  listDomainQuestions,
  createDomainQuestion,
  updateDomainQuestion,
  deleteDomainQuestion,
};
