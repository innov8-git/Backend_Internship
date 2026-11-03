const rateLimit = require('express-rate-limit');
const config = require('./index');

/**
 * Global rate limiter — applied to all routes.
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
 * Strict limiter for login/auth endpoints — 5 attempts per minute per IP.
 */
function createLoginLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.loginWindowMs,
    max: config.rateLimit.loginMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Rate-limit by IP + email combo when possible
      const email = req.body?.email || '';
      return `${req.ip}:${email}`;
    },
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait a minute and try again.',
        details: [],
      },
    },
  });
}

module.exports = { createGlobalLimiter, createLoginLimiter };
