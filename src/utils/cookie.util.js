'use strict';

const config = require('../config');

/**
 * Cookie security utilities for auth & session tokens.
 */

const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Set the refresh token as a secure, httpOnly cookie on the response.
 * @param {import('express').Response} res
 * @param {string} refreshToken - raw random token
 */
function setRefreshTokenCookie(res, refreshToken) {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: DEFAULT_MAX_AGE_MS,
  });
}

/**
 * Clear the refresh token cookie.
 * @param {import('express').Response} res
 */
function clearRefreshTokenCookie(res) {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
  });
}

module.exports = {
  REFRESH_TOKEN_COOKIE_NAME,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
};

