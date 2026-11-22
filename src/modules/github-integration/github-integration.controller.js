'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  noContent,
  generateRandomToken,
} = require('../../utils');
const config = require('../../config');
const logger = require('../../libs/logger');
const { getRedisClient } = require('../../libs/cache');

const DEFAULT_SCOPES = ['read:user', 'public_repo'];
const STATE_TTL_SECONDS = 10 * 60; // 10 minutes
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_API_URL = 'https://api.github.com/user';

// In-memory fallback map when Redis is unavailable (keyed by OAuth state)
const pendingStates = new Map();

function pruneExpiredStates() {
  const now = Date.now();
  for (const [key, entry] of pendingStates.entries()) {
    if (entry.expiresAt <= now) pendingStates.delete(key);
  }
}

async function storeOAuthState(state, userId) {
  pruneExpiredStates();
  const expiresAt = Date.now() + STATE_TTL_SECONDS * 1000;
  pendingStates.set(state, { userId, expiresAt });

  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      await redis.setex(`github:oauth:state:${state}`, STATE_TTL_SECONDS, userId);
    }
  } catch (err) {
    logger.debug(`[GitHub OAuth] Redis state write skipped: ${err.message}`);
  }
}

async function consumeOAuthState(state) {
  let ownerUserId = null;

  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const key = `github:oauth:state:${state}`;
      ownerUserId = await redis.get(key);
      if (ownerUserId) await redis.del(key);
    }
  } catch (err) {
    logger.debug(`[GitHub OAuth] Redis state read skipped: ${err.message}`);
  }

  const local = pendingStates.get(state);
  if (local) {
    pendingStates.delete(state);
    if (!ownerUserId && local.expiresAt > Date.now()) {
      ownerUserId = local.userId;
    }
  }

  return ownerUserId;
}

function clearPendingStatesForUser(userId) {
  for (const [key, entry] of pendingStates.entries()) {
    if (entry.userId === userId) pendingStates.delete(key);
  }
}

/**
 * Encrypts the GitHub OAuth access token at rest using AES-256-GCM derived from JWT_SECRET.
 * Tokens are stored server-side only and are never returned to the browser.
 */
function encryptToken(plaintext) {
  const key = crypto.createHash('sha256').update(String(config.jwt.secret)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function ensureGithubConfigured() {
  if (!config.github.clientId || !config.github.clientSecret) {
    throw ApiError.unprocessable(
      'GITHUB_NOT_CONFIGURED',
      'GitHub OAuth is not configured on the server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
    );
  }
}

function parseScopes(rawScope) {
  if (!rawScope || typeof rawScope !== 'string') return [...DEFAULT_SCOPES];
  const parsed = rawScope
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_SCOPES];
}

/**
 * POST /api/v1/github/connect
 * Generates a single-use CSRF state token and returns GitHub's real OAuth authorization URL.
 */
const connectGithub = asyncHandler(async (req, res) => {
  ensureGithubConfigured();

  const state = generateRandomToken(24);
  await storeOAuthState(state, req.user.id);

  const callbackUrl =
    config.github.callbackUrl || `${config.clientUrl || 'http://localhost:5173'}/github/callback`;

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: callbackUrl,
    scope: DEFAULT_SCOPES.join(' '),
    state,
    allow_signup: 'true',
  });

  const authorizationUrl = `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
  ok(res, { authorizationUrl, state });
});

/**
 * GET /api/v1/github/callback?code=...&state=...
 * Verifies the state token, exchanges the authorization code with GitHub for an access token,
 * fetches the verified GitHub user profile, and persists the connection in PostgreSQL.
 */
const callbackGithub = asyncHandler(async (req, res) => {
  ensureGithubConfigured();

  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';

  if (!code || !state) {
    throw ApiError.badRequest('TOKEN_INVALID', 'Missing GitHub authorization code or state.');
  }

  const stateOwnerId = await consumeOAuthState(state);
  if (!stateOwnerId || stateOwnerId !== req.user.id) {
    throw ApiError.badRequest('TOKEN_INVALID', 'GitHub authorization state is invalid or expired. Please try again.');
  }

  const callbackUrl =
    config.github.callbackUrl || `${config.clientUrl || 'http://localhost:5173'}/github/callback`;

  // 1. Exchange authorization code for an access token with GitHub
  let tokenData;
  try {
    const tokenRes = await axios.post(
      GITHUB_TOKEN_URL,
      {
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
        redirect_uri: callbackUrl,
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );
    tokenData = tokenRes.data;
  } catch (err) {
    logger.warn(`[GitHub OAuth] Token exchange request failed: ${err.message}`);
    throw ApiError.badRequest('GITHUB_OAUTH_FAILED', 'Could not complete GitHub authorization. Please try again.');
  }

  if (!tokenData?.access_token || tokenData.error) {
    logger.warn(`[GitHub OAuth] GitHub returned error: ${tokenData?.error_description || tokenData?.error || 'no access_token'}`);
    throw ApiError.badRequest(
      'GITHUB_OAUTH_FAILED',
      tokenData?.error_description || 'GitHub rejected the authorization code. Please try again.',
    );
  }

  // 2. Fetch the verified GitHub user profile
  let ghUser;
  try {
    const userRes = await axios.get(GITHUB_USER_API_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ALFRE-Internship-Portal',
      },
      timeout: 10000,
    });
    ghUser = userRes.data;
  } catch (err) {
    logger.warn(`[GitHub OAuth] Failed to fetch GitHub user profile: ${err.message}`);
    throw ApiError.badRequest('GITHUB_OAUTH_FAILED', 'Could not verify your GitHub profile. Please try again.');
  }

  if (!ghUser?.login) {
    throw ApiError.badRequest('GITHUB_OAUTH_FAILED', 'GitHub did not return a valid username.');
  }

  const scopes = parseScopes(tokenData.scope);
  const encryptedAccessToken = encryptToken(tokenData.access_token);
  const now = new Date();

  const connection = await prisma.githubConnection.upsert({
    where: { userId: req.user.id },
    update: {
      githubId: ghUser.id ? String(ghUser.id) : null,
      githubUsername: ghUser.login,
      accessToken: encryptedAccessToken,
      scopes,
      connectedAt: now,
    },
    create: {
      userId: req.user.id,
      githubId: ghUser.id ? String(ghUser.id) : null,
      githubUsername: ghUser.login,
      accessToken: encryptedAccessToken,
      scopes,
      connectedAt: now,
    },
  });

  logger.info(`[GitHub OAuth] Connected @${connection.githubUsername} for user ${req.user.id}`);

  ok(res, {
    connected: true,
    githubUsername: connection.githubUsername,
    scopes,
    connectedAt: connection.connectedAt,
  });
});

/**
 * POST /api/v1/github/connection
 * Returns public connection metadata (accessToken is never selected or returned).
 */
const getConnectionStatus = asyncHandler(async (req, res) => {
  const connection = await prisma.githubConnection.findUnique({
    where: { userId: req.user.id },
    select: {
      githubUsername: true,
      scopes: true,
      connectedAt: true,
    },
  });

  if (!connection) {
    return ok(res, {
      connected: false,
      githubUsername: null,
      scopes: [],
      connectedAt: null,
    });
  }

  ok(res, {
    connected: true,
    githubUsername: connection.githubUsername,
    scopes: Array.isArray(connection.scopes) ? connection.scopes : JSON.parse(connection.scopes || '[]'),
    connectedAt: connection.connectedAt,
  });
});

/**
 * DELETE /api/v1/github/connection
 */
const disconnectGithub = asyncHandler(async (req, res) => {
  await prisma.githubConnection.deleteMany({
    where: { userId: req.user.id },
  });

  clearPendingStatesForUser(req.user.id);

  noContent(res);
});

module.exports = {
  connectGithub,
  callbackGithub,
  getConnectionStatus,
  disconnectGithub,
};
