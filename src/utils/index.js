'use strict';

const ApiError = require('./ApiError');
const { ok, created, noContent, message } = require('./response.util');
const {
  parsePagination,
  parseSort,
  buildOrderBy,
  paginatedResponse,
  buildSearchFilter,
  buildDateRangeFilter,
} = require('./pagination.util');
const { hashPassword, comparePassword } = require('./hash.util');
const {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  generateRandomToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_NAME,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
} = require('./token.util');
const {
  setRefreshTokenCookie: setCookie,
  clearRefreshTokenCookie: clearCookie,
} = require('./cookie.util');
const { slugify, uniqueSlug } = require('./slug.util');

/**
 * Wrap an async route handler so thrown errors are caught and forwarded to Express.
 * Removes the need for try/catch in every controller.
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Transform a Prisma record to the frontend's expected shape.
 * Maps `id` -> `_id` and removes internal fields.
 * @param {object} record - Prisma record
 * @param {string[]} [omit] - fields to omit (e.g., 'passwordHash')
 * @returns {object}
 */
function toDto(record, omit = []) {
  if (!record) return null;
  const dto = { _id: record.id, ...record };
  delete dto.id;
  for (const field of omit) {
    delete dto[field];
  }
  return dto;
}

/**
 * Transform an array of Prisma records to DTOs.
 */
function toDtoList(records, omit = []) {
  return records.map((r) => toDto(r, omit));
}

module.exports = {
  ApiError,
  asyncHandler,
  toDto,
  toDtoList,

  // Response helpers
  ok,
  created,
  noContent,
  message,

  // Pagination
  parsePagination,
  parseSort,
  buildOrderBy,
  paginatedResponse,
  buildSearchFilter,
  buildDateRangeFilter,

  // Auth helpers
  hashPassword,
  comparePassword,
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  generateRandomToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_NAME,
  // Backward compatibility
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,

  // Slug
  slugify,
  uniqueSlug,
};
