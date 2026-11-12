'use strict';

const rateLimit = require('express-rate-limit');
const config = require('./index');

/**
 * Global rate limiter — applied to all API routes.
 */
function createGlobalLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
        details: [],
      },
    },
  });
}

/**
 * Strict limiter for Auth endpoints (login, register, forgot-password)
 * Defaults to 10 requests per 15 minutes per IP.
 */
function createAuthLimiter() {
  const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000', 10);
  const max = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = req.body?.email || '';
      return `${req.ip}:${email}`;
    },
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait 15 minutes and try again.',
        details: [],
      },
    },
  });
}

/**
 * Strict limiter for login attempts (1 minute window).
 */
function createLoginLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.loginWindowMs,
    max: config.rateLimit.loginMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = req.body?.email || '';
      return `${req.ip}:${email}`;
    },
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Please wait a minute and try again.',
        details: [],
      },
    },
  });
}

module.exports = {
  createGlobalLimiter,
  createAuthLimiter,
  createLoginLimiter,
};
