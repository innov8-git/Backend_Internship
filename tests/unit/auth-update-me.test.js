'use strict';

process.env.NODE_ENV = 'test';

const mockTx = {
  user: { update: jest.fn() },
  trainerProfile: { upsert: jest.fn() },
};

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((fn) => fn(mockTx)),
};

jest.mock('../../src/database', () => ({ prisma: mockPrisma }));

const request = require('supertest');
const app = require('../../src/app');
const { generateAccessToken } = require('../../src/utils');
const { invalidateAuthUserCache } = require('../../src/common/guards');

function makeUser(id, roleName, overrides = {}) {
  return {
    id,
    name: 'Asha Rao',
    email: `${roleName.toLowerCase()}@example.com`,
    status: 'ACTIVE',
    emailVerified: true,
    avatarUrl: null,
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
    authProvider: 'LOCAL',
    trainerProfile: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userRoles: [{ role: { name: roleName, rolePermissions: [] } }],
    ...overrides,
  };
}

function bearerFor(id, roleName) {
  return `Bearer ${generateAccessToken({ sub: id, email: `${roleName.toLowerCase()}@example.com`, roles: [roleName] })}`;
}

describe('PATCH /api/v1/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAuthUserCache();
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).patch('/api/v1/auth/me').send({ name: 'New Name' });
    expect(res.status).toBe(401);
  });

  test('updates allowed profile fields and strips privileged fields like email/roles/status', async () => {
    const student = makeUser('stu-1', 'STUDENT');
    const updatedStudent = makeUser('stu-1', 'STUDENT', {
      name: 'Asha Verma',
      headline: 'Full-Stack Intern',
      phone: '+91 9876543210',
      graduationYear: '2026',
    });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(student) // auth guard
      .mockResolvedValueOnce(student) // updateMe lookup
      .mockResolvedValueOnce(updatedStudent); // getMe after update

    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor('stu-1', 'STUDENT'))
      .send({
        name: 'Asha Verma',
        headline: 'Full-Stack Intern',
        phone: '+91 9876543210',
        graduationYear: '2026',
        email: 'hacker@evil.com',
        roles: ['ADMIN'],
        status: 'SUSPENDED',
        passwordHash: 'fake',
      });

    expect(res.status).toBe(200);
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'stu-1' },
      data: {
        name: 'Asha Verma',
        headline: 'Full-Stack Intern',
        phone: '+91 9876543210',
        graduationYear: '2026',
      },
    });
    expect(res.body.data).toMatchObject({
      _id: 'stu-1',
      id: 'stu-1',
      name: 'Asha Verma',
      headline: 'Full-Stack Intern',
      email: 'student@example.com',
    });
  });

  test('accepts base64 image data-URL and null removal for avatarUrl', async () => {
    const student = makeUser('stu-2', 'STUDENT');
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(makeUser('stu-2', 'STUDENT', { avatarUrl: dataUrl }));

    const uploadRes = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor('stu-2', 'STUDENT'))
      .send({ avatarUrl: dataUrl });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.data.avatarUrl).toBe(dataUrl);

    invalidateAuthUserCache();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(makeUser('stu-2', 'STUDENT', { avatarUrl: null }));

    const clearRes = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor('stu-2', 'STUDENT'))
      .send({ avatarUrl: null });

    expect(clearRes.status).toBe(200);
    expect(mockTx.user.update).toHaveBeenLastCalledWith({
      where: { id: 'stu-2' },
      data: { avatarUrl: null },
    });
  });

  test('upserts trainerProfile only when user has TRAINER role', async () => {
    const trainer = makeUser('tr-1', 'TRAINER');
    const updatedTrainer = makeUser('tr-1', 'TRAINER', {
      trainerProfile: { domain: 'Backend Engineering', experience: '5-8 years', resumeName: 'cv.pdf', resumeSize: 12345 },
    });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(trainer)
      .mockResolvedValueOnce(trainer)
      .mockResolvedValueOnce(updatedTrainer);

    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor('tr-1', 'TRAINER'))
      .send({
        trainerProfile: {
          domain: 'Backend Engineering',
          experience: '5-8 years',
          resumeName: 'cv.pdf',
          resumeSize: 12345,
        },
      });

    expect(res.status).toBe(200);
    expect(mockTx.trainerProfile.upsert).toHaveBeenCalledTimes(1);

    // Now verify a STUDENT cannot upsert trainerProfile
    jest.clearAllMocks();
    invalidateAuthUserCache();
    const student = makeUser('stu-3', 'STUDENT');
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(student);

    const studentRes = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor('stu-3', 'STUDENT'))
      .send({ trainerProfile: { domain: 'Hacked' } });

    expect(studentRes.status).toBe(200);
    expect(mockTx.trainerProfile.upsert).not.toHaveBeenCalled();
  });

  test('returns 422 on invalid fields or empty payload', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser('stu-4', 'STUDENT'));

    const emptyRes = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor('stu-4', 'STUDENT'))
      .send({});
    expect(emptyRes.status).toBe(422);

    const badUrlRes = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', bearerFor('stu-4', 'STUDENT'))
      .send({ linkedinUrl: 'javascript:alert(1)' });
    expect(badUrlRes.status).toBe(422);
  });
});
