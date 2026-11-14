'use strict';

const config = require('../config');

/**
 * Cookie security utilities for auth & session tokens.
 */

const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Set the refresh token as a secure, httpOnly cookie on the response.
 * Also clears any legacy cookie set with the previous path '/api/v1/auth'.
 * @param {import('express').Response} res
 * @param {string} refreshToken - raw random token
 */
function setRefreshTokenCookie(res, refreshToken) {
  // Purge any zombie cookie created with the old restricted path
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api/v1/auth',
  });

  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: DEFAULT_MAX_AGE_MS,
  });
}

/**
 * Clear the refresh token cookie on all paths.
 * @param {import('express').Response} res
 */
function clearRefreshTokenCookie(res) {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

/**
 * Robustly extract a non-empty refresh token from request cookies, headers, or body.
 * Resolves browser duplicates when older path cookies conflict with root cookies.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function getRefreshTokenFromRequest(req) {
  if (req.body?.refreshToken) {
    return req.body.refreshToken;
  }

  const parsed = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  if (parsed && typeof parsed === 'string' && parsed.trim().length > 0) {
    return parsed.trim();
  }

  const rawCookieHeader = req.headers?.cookie;
  if (rawCookieHeader) {
    const matches = rawCookieHeader.matchAll(
      new RegExp(`(?:^|;\\s*)${REFRESH_TOKEN_COOKIE_NAME}=([^;]+)`, 'g')
    );
    for (const match of matches) {
      const val = decodeURIComponent(match[1]).trim();
      if (val.length > 0) {
        return val;
      }
    }
  }

  return null;
}

module.exports = {
  REFRESH_TOKEN_COOKIE_NAME,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
};

