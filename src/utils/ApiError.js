const { StatusCodes } = require('http-status-codes');

/**
 * Standard API error class.
 * Maps to the frontend's expected error envelope:
 * { success: false, error: { code, message, details: [{ field, message }] } }
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} code       - Machine-readable error code (e.g. 'VALIDATION_ERROR')
   * @param {string} message    - Human-readable message
   * @param {Array}  details    - Field-level errors [{ field, message }]
   */
  constructor(statusCode, code, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  /** Serialise to the envelope the frontend expects. */
  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }

  // ─── Factory methods ──────────────────────────────────────────────────────

  static badRequest(code, message, details = []) {
    return new ApiError(StatusCodes.BAD_REQUEST, code, message, details);
  }

  static unauthorized(code = 'UNAUTHENTICATED', message = 'Authentication required.') {
    return new ApiError(StatusCodes.UNAUTHORIZED, code, message);
  }

  static invalidCredentials(message = 'Invalid email or password.') {
    return new ApiError(StatusCodes.UNAUTHORIZED, 'INVALID_CREDENTIALS', message);
  }

  static forbidden(code = 'FORBIDDEN', message = "You don't have permission to access this resource.") {
    return new ApiError(StatusCodes.FORBIDDEN, code, message);
  }

  static notFound(resource = 'Resource') {
    return new ApiError(StatusCodes.NOT_FOUND, 'NOT_FOUND', `${resource} not found.`);
  }

  static conflict(code, message, details = []) {
    return new ApiError(StatusCodes.CONFLICT, code, message, details);
  }

  static gone(code, message) {
    return new ApiError(StatusCodes.GONE, code, message);
  }

  static validationError(details, message = 'Please check the highlighted fields.') {
    return new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', message, details);
  }

  static unprocessable(code, message, details = []) {
    return new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, code, message, details);
  }

  static tooManyRequests(message = 'Too many attempts. Please wait and try again.') {
    return new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'RATE_LIMITED', message);
  }

  static internal(message = 'An internal error occurred. Please try again later.') {
    return new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', message);
  }
}

module.exports = ApiError;
