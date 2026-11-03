const ApiError = require('../../utils/ApiError');
const logger = require('../../libs/logger');

/**
 * Global error handler middleware.
 * Converts all errors to the standard error envelope the frontend expects:
 * { success: false, error: { code, message, details } }
 */
function errorHandler(err, _req, res, _next) {
  // Already an ApiError — send it directly
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Prisma known request errors (e.g., unique constraint violation)
  if (err.code === 'P2002') {
    const target = err.meta?.target || [];
    const field = Array.isArray(target) ? target[0] : 'field';
    const apiErr = ApiError.conflict(
      'DUPLICATE_VALUE',
      `A record with this ${field} already exists.`,
      [{ field, message: `This ${field} is already taken.` }],
    );
    return res.status(apiErr.statusCode).json(apiErr.toJSON());
  }

  // Prisma record not found
  if (err.code === 'P2025') {
    const apiErr = ApiError.notFound('Resource');
    return res.status(apiErr.statusCode).json(apiErr.toJSON());
  }

  // JSON parse error
  if (err.type === 'entity.parse.failed') {
    const apiErr = ApiError.badRequest('INVALID_JSON', 'The request body is not valid JSON.');
    return res.status(apiErr.statusCode).json(apiErr.toJSON());
  }

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    const apiErr = ApiError.badRequest('FILE_TOO_LARGE', 'File exceeds the maximum allowed size (5 MB).');
    return res.status(apiErr.statusCode).json(apiErr.toJSON());
  }

  // Multer too many files
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    const apiErr = ApiError.badRequest('TOO_MANY_FILES', 'Too many files uploaded.');
    return res.status(apiErr.statusCode).json(apiErr.toJSON());
  }

  // JWT errors that slipped through middleware
  if (err.name === 'JsonWebTokenError') {
    const apiErr = ApiError.unauthorized('UNAUTHENTICATED', 'Invalid authentication token.');
    return res.status(apiErr.statusCode).json(apiErr.toJSON());
  }

  if (err.name === 'TokenExpiredError') {
    const apiErr = ApiError.unauthorized('TOKEN_EXPIRED', 'Your session has expired.');
    return res.status(apiErr.statusCode).json(apiErr.toJSON());
  }

  // Unknown error — log it and return 500
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    code: err.code,
  });

  const apiErr = ApiError.internal();
  return res.status(apiErr.statusCode).json(apiErr.toJSON());
}

/**
 * 404 handler — catch-all for undefined routes.
 */
function notFoundHandler(req, res) {
  const apiErr = ApiError.notFound('Route');
  res.status(apiErr.statusCode).json(apiErr.toJSON());
}

module.exports = { errorHandler, notFoundHandler };
