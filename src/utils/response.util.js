const { StatusCodes } = require('http-status-codes');

/**
 * Response helpers — consistent shapes for every success response.
 *
 * The frontend's `unwrap()` handles both plain resources and `{ success: true, data }`.
 * We send plain resources (no wrapper) for GETs, and optionally use the envelope.
 */

/**
 * Send a plain JSON response (200 OK).
 */
function ok(res, data) {
  return res.status(StatusCodes.OK).json(data);
}

/**
 * Send a 201 Created response.
 */
function created(res, data) {
  return res.status(StatusCodes.CREATED).json(data);
}

/**
 * Send a 204 No Content response.
 */
function noContent(res) {
  return res.status(StatusCodes.NO_CONTENT).send();
}

/**
 * Send a message-only success response.
 */
function message(res, msg, statusCode = StatusCodes.OK) {
  return res.status(statusCode).json({ message: msg });
}

module.exports = { ok, created, noContent, message };
