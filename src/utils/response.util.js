'use strict';

const { StatusCodes } = require('http-status-codes');

/**
 * Standard API Response Utilities
 * Enforces unified response format: { success: true, message, data }
 */

/**
 * Send a 200 OK success response.
 * @param {import('express').Response} res
 * @param {any} [data]
 * @param {string} [msg]
 */
function ok(res, data = null, msg = null) {
  const payload = { success: true };
  if (msg) payload.message = msg;
  if (data !== null && data !== undefined) payload.data = data;
  return res.status(StatusCodes.OK).json(payload);
}

/**
 * Send a 201 Created success response.
 * @param {import('express').Response} res
 * @param {any} [data]
 * @param {string} [msg]
 */
function created(res, data = null, msg = null) {
  const payload = { success: true };
  if (msg) payload.message = msg;
  if (data !== null && data !== undefined) payload.data = data;
  return res.status(StatusCodes.CREATED).json(payload);
}

/**
 * Send a 204 No Content response.
 * @param {import('express').Response} res
 */
function noContent(res) {
  return res.status(StatusCodes.NO_CONTENT).send();
}

/**
 * Send a message-only success response.
 * @param {import('express').Response} res
 * @param {string} msg
 * @param {number} [statusCode=200]
 */
function message(res, msg, statusCode = StatusCodes.OK) {
  return res.status(statusCode).json({ success: true, message: msg });
}

module.exports = { ok, created, noContent, message };
