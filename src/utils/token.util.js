'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
  REFRESH_TOKEN_COOKIE_NAME,
} = require('./cookie.util');

/**
 * JWT & Cryptographic Token Utilities
 */

/**
 * Sign an Access Token (JWT).
 * @param {{ sub?: string, userId?: string, email?: string, roles?: string[] }} payload
 * @returns {string} Signed JWT
 */
function generateAccessToken(payload) {
  const jwtPayload = {
    sub: payload.sub || payload.userId,
    email: payload.email,
    roles: payload.roles || [],
  };

  return jwt.sign(jwtPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn || '15m',
  });
}

/**
 * Verify an Access Token (JWT).
 * @param {string} token
 * @returns {object} Decoded token payload
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

/**
 * Generate a cryptographically secure 64-byte random hex string for Refresh Tokens.
 * @param {number} [bytes=64]
 * @returns {string} hex string
 */
function generateRefreshToken(bytes = 64) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Compute SHA-256 hash of a raw token string before storing in database.
 * @param {string} rawToken
 * @returns {string} 64-character hex hash
 */
function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('hashToken requires a non-empty string');
  }
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generate a random verification / reset token (default 32 bytes).
 * @param {number} [bytes=32]
 * @returns {string} hex string
 */
function generateRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Backward compatibility aliases */
const signAccessToken = generateAccessToken;
const setRefreshCookie = setRefreshTokenCookie;
const clearRefreshCookie = clearRefreshTokenCookie;

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  generateRandomToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
  REFRESH_TOKEN_COOKIE_NAME,
  // Aliases
  signAccessToken,
  setRefreshCookie,
  clearRefreshCookie,
};
