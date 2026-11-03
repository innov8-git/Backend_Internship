const { prisma } = require('../../database');
const {
  ApiError,
  asyncHandler,
  ok,
  noContent,
  generateRandomToken,
  generateSlug,
} = require('../../utils');
const config = require('../../config');

const DEFAULT_SCOPES = ['read:user', 'public_repo'];

// In-memory pending states map (cache)
const pendingStates = new Map();

function usernameFor(user) {
  const base = generateSlug(user.name || '') || generateSlug(user.email.split('@')[0]);
  const trimmed = (base || 'student').slice(0, 35).replace(/-+$/g, '');
  return `${trimmed || 'student'}-dev`;
}

const connectGithub = asyncHandler(async (req, res) => {
  const state = generateRandomToken();
  const code = generateRandomToken();

  pendingStates.set(req.user.id, {
    state,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const frontendUrl = config.cors.origin || 'http://localhost:5173';
  const query = new URLSearchParams({ code, state }).toString();
  const authorizationUrl = `${frontendUrl}/github/callback?${query}`;

  ok(res, { authorizationUrl, state });
});

const callbackGithub = asyncHandler(async (req, res) => {
  const { code, state } = req.query;

  const pending = pendingStates.get(req.user.id);
  const valid =
    Boolean(code && state && pending) &&
    pending.state === state &&
    pending.code === code &&
    pending.expiresAt > Date.now();

  if (!valid) {
    throw ApiError.badRequest('TOKEN_INVALID', 'GitHub authorization failed. Please try again.');
  }

  const existing = await prisma.githubConnection.findUnique({
    where: { userId: req.user.id },
  });

  let connection;
  if (existing) {
    connection = await prisma.githubConnection.update({
      where: { userId: req.user.id },
      data: {
        scopes: DEFAULT_SCOPES,
        connectedAt: new Date(),
      },
    });
  } else {
    connection = await prisma.githubConnection.create({
      data: {
        userId: req.user.id,
        githubUsername: usernameFor(req.user),
        scopes: DEFAULT_SCOPES,
        connectedAt: new Date(),
      },
    });
  }

  pendingStates.delete(req.user.id);

  ok(res, { connected: true, githubUsername: connection.githubUsername });
});

const getConnectionStatus = asyncHandler(async (req, res) => {
  const connection = await prisma.githubConnection.findUnique({
    where: { userId: req.user.id },
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

const disconnectGithub = asyncHandler(async (req, res) => {
  await prisma.githubConnection.deleteMany({
    where: { userId: req.user.id },
  });

  pendingStates.delete(req.user.id);

  noContent(res);
});

module.exports = {
  connectGithub,
  callbackGithub,
  getConnectionStatus,
  disconnectGithub,
};
