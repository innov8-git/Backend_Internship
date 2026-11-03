const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

/**
 * JWT + random token utilities.
 */

/**
 * Sign an access token.
 * @param {{ userId: string, roles: string[] }} payload
 * @returns {string}
 */
function signAccessToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

/**
 * Sign a refresh token.
 * @param {{ userId: string }} payload
 * @returns {string}
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
}

/**
 * Verify an access token.
 * @param {string} token
 * @returns {{ userId: string, roles: string[] }}
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

/**
 * Verify a refresh token.
 * @param {string} token
 * @returns {{ userId: string }}
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

/**
 * Generate a cryptographically secure random token (hex).
 * Used for email verification, password reset, invite tokens.
 * @param {number} [bytes=32] - Number of random bytes
 * @returns {string} hex string
 */
function generateRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Parse the refresh token expiry string (e.g. '7d') into milliseconds.
 * Used for setting cookie maxAge.
 */
function getRefreshTokenMaxAge() {
  const raw = config.jwt.refreshExpiresIn || '7d';
  const match = raw.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days

  const [, num, unit] = match;
  const value = parseInt(num, 10);
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 86400000);
}

/**
 * Set the refresh token as an httpOnly cookie on the response.
 */
function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'strict' : 'lax',
    maxAge: getRefreshTokenMaxAge(),
    path: '/',
  });
}

/**
 * Clear the refresh token cookie.
 */
function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'strict' : 'lax',
    path: '/',
  });
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateRandomToken,
  getRefreshTokenMaxAge,
  setRefreshCookie,
  clearRefreshCookie,
};
