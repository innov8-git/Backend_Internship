'use strict';

process.env.NODE_ENV = 'test';
process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  githubConnection: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  },
};

jest.mock('../../src/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/libs/cache', () => ({ getRedisClient: () => null }));
jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

const axios = require('axios');
const request = require('supertest');
const app = require('../../src/app');
const { generateAccessToken } = require('../../src/utils');
const { invalidateAuthUserCache } = require('../../src/common/guards');

const STUDENT_ID = 'stu-gh-1';

function studentUser() {
  return {
    id: STUDENT_ID,
    name: 'Aarav Sharma',
    email: 'aarav@example.com',
    status: 'ACTIVE',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    userRoles: [{ role: { name: 'STUDENT', rolePermissions: [] } }],
  };
}

function authHeader() {
  const token = generateAccessToken({ sub: STUDENT_ID, email: 'aarav@example.com', roles: ['STUDENT'] });
  return `Bearer ${token}`;
}

describe('Real GitHub OAuth integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAuthUserCache();
  });

  test('POST /api/v1/github/connect returns real GitHub authorize URL + state', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(studentUser());

    const res = await request(app)
      .post('/api/v1/github/connect')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.state).toBeTruthy();
    const url = new URL(res.body.data.authorizationUrl);
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('state')).toBe(res.body.data.state);
    expect(url.searchParams.get('client_id')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('read:user');
  });

  test('GET /api/v1/github/callback exchanges code, fetches real GitHub user, encrypts token, and never leaks token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(studentUser());

    // Step 1: start connect to get a valid state
    const connectRes = await request(app)
      .post('/api/v1/github/connect')
      .set('Authorization', authHeader());
    const { state } = connectRes.body.data;

    // Step 2: mock GitHub token exchange + /user API
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'gho_secret_token_12345', scope: 'read:user,public_repo' },
    });
    axios.get.mockResolvedValueOnce({
      data: { id: 987654, login: 'aarav-real-gh' },
    });

    const connectedAt = new Date();
    mockPrisma.githubConnection.upsert.mockResolvedValueOnce({
      id: 'gh-conn-1',
      userId: STUDENT_ID,
      githubId: '987654',
      githubUsername: 'aarav-real-gh',
      scopes: ['read:user', 'public_repo'],
      connectedAt,
    });

    const cbRes = await request(app)
      .get(`/api/v1/github/callback?code=gh_code_abc&state=${encodeURIComponent(state)}`)
      .set('Authorization', authHeader());

    expect(cbRes.status).toBe(200);
    expect(cbRes.body.data).toMatchObject({
      connected: true,
      githubUsername: 'aarav-real-gh',
      scopes: ['read:user', 'public_repo'],
    });
    expect(cbRes.body.data.accessToken).toBeUndefined();

    // Stored access token must be encrypted (iv:tag:ciphertext), NOT plaintext
    const upsertArg = mockPrisma.githubConnection.upsert.mock.calls[0][0];
    expect(upsertArg.create.accessToken).toBeTruthy();
    expect(upsertArg.create.accessToken).not.toContain('gho_secret_token_12345');
    expect(upsertArg.create.accessToken.split(':')).toHaveLength(3);

    // Reusing the same state must fail with 400 TOKEN_INVALID
    const replayRes = await request(app)
      .get(`/api/v1/github/callback?code=gh_code_abc&state=${encodeURIComponent(state)}`)
      .set('Authorization', authHeader());
    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error.code).toBe('TOKEN_INVALID');
  });

  test('GET /api/v1/github/connection returns metadata and DELETE disconnects', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(studentUser());
    mockPrisma.githubConnection.findUnique.mockResolvedValueOnce({
      githubUsername: 'aarav-real-gh',
      scopes: ['read:user', 'public_repo'],
      connectedAt: new Date(),
    });

    const statusRes = await request(app)
      .get('/api/v1/github/connection')
      .set('Authorization', authHeader());

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.connected).toBe(true);
    expect(statusRes.body.data.githubUsername).toBe('aarav-real-gh');

    mockPrisma.githubConnection.deleteMany.mockResolvedValueOnce({ count: 1 });
    const delRes = await request(app)
      .delete('/api/v1/github/connection')
      .set('Authorization', authHeader());

    expect(delRes.status).toBe(204);
  });
});
