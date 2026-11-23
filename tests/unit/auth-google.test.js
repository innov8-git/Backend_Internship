'use strict';

process.env.NODE_ENV = 'test';

const mockVerifyIdToken = jest.fn();
const mockGetToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
    getToken: mockGetToken,
  })),
}));

const mockTx = {
  user: { create: jest.fn() },
  userRole: { create: jest.fn() },
};

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  roleModel: { findUnique: jest.fn() },
  token: { create: jest.fn() },
  $transaction: jest.fn((fn) => fn(mockTx)),
};

jest.mock('../../src/database', () => ({ prisma: mockPrisma }));

const request = require('supertest');
const app = require('../../src/app');
const { REFRESH_TOKEN_COOKIE_NAME } = require('../../src/utils');

function fullUser(overrides = {}) {
  return {
    id: 'u-google-1',
    name: 'Alex Chen',
    email: 'alex@example.com',
    status: 'ACTIVE',
    emailVerified: true,
    avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
    phone: null,
    headline: null,
    bio: null,
    location: null,
    college: null,
    degree: null,
    graduationYear: null,
    department: null,
    organization: null,
    linkedinUrl: null,
    portfolioUrl: null,
    googleId: 'google-sub-123',
    authProvider: 'GOOGLE',
    trainerProfile: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userRoles: [{ role: { name: 'STUDENT', rolePermissions: [] } }],
    ...overrides,
  };
}

describe('POST /api/v1/auth/google', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a new ACTIVE student account and sets httpOnly refresh cookie', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'google-sub-123',
        email: 'Alex@Example.com',
        email_verified: true,
        name: 'Alex Chen',
        picture: 'https://lh3.googleusercontent.com/avatar.jpg',
      }),
    });

    const created = fullUser();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // not found by email
      .mockResolvedValueOnce(created); // getMe
    mockPrisma.roleModel.findUnique.mockResolvedValueOnce({ id: 'role-student', name: 'STUDENT' });
    mockTx.user.create.mockResolvedValueOnce(created);
    mockTx.userRole.create.mockResolvedValueOnce({});
    mockPrisma.token.create.mockResolvedValueOnce({ id: 'tok-1' });

    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ credential: 'valid.google.idtoken' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user).toMatchObject({
      _id: 'u-google-1',
      email: 'alex@example.com',
      roles: ['STUDENT'],
      emailVerified: true,
    });
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`) && c.includes('HttpOnly'))).toBe(true);
    expect(mockTx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'alex@example.com',
          status: 'ACTIVE',
          emailVerified: true,
          authProvider: 'GOOGLE',
          googleId: 'google-sub-123',
        }),
      }),
    );
  });

  test('logs in existing user and activates PENDING_VERIFICATION', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'google-sub-existing',
        email: 'existing@example.com',
        email_verified: true,
        name: 'Existing User',
      }),
    });

    const existing = fullUser({
      id: 'u-existing',
      email: 'existing@example.com',
      status: 'PENDING_VERIFICATION',
      emailVerified: false,
      googleId: null,
    });
    const activated = fullUser({ id: 'u-existing', email: 'existing@example.com' });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(activated);
    mockPrisma.user.update.mockResolvedValueOnce(activated);
    mockPrisma.token.create.mockResolvedValueOnce({ id: 'tok-2' });

    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ credential: 'valid.google.idtoken' });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-existing' },
      data: expect.objectContaining({
        googleId: 'google-sub-existing',
        emailVerified: true,
        status: 'ACTIVE',
      }),
    });
    expect(res.body.data.user.email).toBe('existing@example.com');
  });

  test('supports OAuth authorization code flow via getToken + verifyIdToken', async () => {
    mockGetToken.mockResolvedValueOnce({ tokens: { id_token: 'exchanged.id.token' } });
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'google-sub-code',
        email: 'codeuser@example.com',
        email_verified: true,
        name: 'Code User',
      }),
    });

    const user = fullUser({ id: 'u-code', email: 'codeuser@example.com', googleId: 'google-sub-code' });
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(user);
    mockPrisma.token.create.mockResolvedValueOnce({ id: 'tok-3' });

    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ code: '4/0AcvDMr_valid_code' });

    expect(res.status).toBe(200);
    expect(mockGetToken).toHaveBeenCalledWith('4/0AcvDMr_valid_code');
    expect(res.body.data.user.email).toBe('codeuser@example.com');
  });

  test('returns 403 ACCOUNT_SUSPENDED when user is suspended', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'google-sub-suspended',
        email: 'suspended@example.com',
        email_verified: true,
        name: 'Suspended',
      }),
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce(
      fullUser({ id: 'u-susp', email: 'suspended@example.com', status: 'SUSPENDED' }),
    );

    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ credential: 'valid.token' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  test('returns 401 INVALID_GOOGLE_TOKEN when verification fails', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Wrong recipient'));

    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ credential: 'bad.token' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
  });

  test('returns 422 when neither credential nor code is supplied', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({});
    expect(res.status).toBe(422);
  });
});
