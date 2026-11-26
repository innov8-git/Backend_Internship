'use strict';

process.env.NODE_ENV = 'test';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  trainerProfile: { upsert: jest.fn() },
};

const mockStorage = {
  upload: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../../src/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/libs/storage', () => ({
  getStorage: () => mockStorage,
  LocalStorage: class LocalStorage {},
}));

const request = require('supertest');
const app = require('../../src/app');
const { generateAccessToken } = require('../../src/utils');
const { invalidateAuthUserCache } = require('../../src/common/guards');

// Valid minimal 1x1 PNG signature + bytes
const VALID_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);
const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

function makeUser(id, roleName, overrides = {}) {
  return {
    id,
    name: 'Asha Rao',
    email: `${roleName.toLowerCase()}@example.com`,
    status: 'ACTIVE',
    emailVerified: true,
    avatarUrl: null,
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

describe('Cloudinary profile picture & trainer resume upload endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAuthUserCache();
  });

  test('POST /api/v1/auth/me/avatar uploads student profile picture to storage (Cloudinary) and saves URL', async () => {
    const student = makeUser('stu-upload-1', 'STUDENT');
    const cloudUrl = 'https://res.cloudinary.com/qmp6tnnz/image/upload/v1/internship-portal/avatars/avatar.png';
    const updatedStudent = makeUser('stu-upload-1', 'STUDENT', { avatarUrl: cloudUrl });

    mockStorage.upload.mockResolvedValueOnce({
      storageKey: 'internship-portal/avatars/avatar.png',
      url: cloudUrl,
      name: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: VALID_PNG.length,
      resourceType: 'image',
    });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(student) // auth guard
      .mockResolvedValueOnce(student) // setAvatarUrl lookup
      .mockResolvedValueOnce(updatedStudent); // getMe

    const res = await request(app)
      .post('/api/v1/auth/me/avatar')
      .set('Authorization', bearerFor('stu-upload-1', 'STUDENT'))
      .attach('avatar', VALID_PNG, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'photo.png',
      'image/png',
      { folder: 'avatars' },
    );
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'stu-upload-1' },
      data: { avatarUrl: cloudUrl },
    });
    expect(res.body.data.avatarUrl).toBe(cloudUrl);
  });

  test('POST /api/v1/auth/me/resume uploads trainer resume to storage (Cloudinary) and updates trainerProfile', async () => {
    const trainer = makeUser('tr-upload-1', 'TRAINER', {
      trainerProfile: { resumeKey: 'internship-portal/resumes/old.pdf' },
    });
    const cloudResumeUrl = 'https://res.cloudinary.com/qmp6tnnz/raw/upload/v1/internship-portal/resumes/new.pdf';
    const updatedTrainer = makeUser('tr-upload-1', 'TRAINER', {
      trainerProfile: {
        resumeUrl: cloudResumeUrl,
        resumeKey: 'internship-portal/resumes/new.pdf',
        resumeName: 'Trainer_CV.pdf',
        resumeMimeType: 'application/pdf',
        resumeSize: VALID_PDF.length,
      },
    });

    mockStorage.upload.mockResolvedValueOnce({
      storageKey: 'internship-portal/resumes/new.pdf',
      url: cloudResumeUrl,
      name: 'Trainer_CV.pdf',
      mimeType: 'application/pdf',
      sizeBytes: VALID_PDF.length,
      resourceType: 'raw',
    });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(trainer) // auth guard
      .mockResolvedValueOnce(trainer) // setTrainerResume lookup
      .mockResolvedValueOnce(updatedTrainer); // getMe

    const res = await request(app)
      .post('/api/v1/auth/me/resume')
      .set('Authorization', bearerFor('tr-upload-1', 'TRAINER'))
      .attach('resume', VALID_PDF, { filename: 'Trainer_CV.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'Trainer_CV.pdf',
      'application/pdf',
      { folder: 'resumes' },
    );
    expect(mockPrisma.trainerProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'tr-upload-1' },
        update: expect.objectContaining({
          resumeUrl: cloudResumeUrl,
          resumeKey: 'internship-portal/resumes/new.pdf',
          resumeName: 'Trainer_CV.pdf',
        }),
      }),
    );
    expect(mockStorage.delete).toHaveBeenCalledWith('internship-portal/resumes/old.pdf', 'raw');
    expect(res.body.data.trainerProfile.resumeUrl).toBe(cloudResumeUrl);
  });

  test('POST /api/v1/auth/me/resume forbids STUDENT accounts', async () => {
    const student = makeUser('stu-denied', 'STUDENT');
    mockPrisma.user.findUnique.mockResolvedValueOnce(student);

    const res = await request(app)
      .post('/api/v1/auth/me/resume')
      .set('Authorization', bearerFor('stu-denied', 'STUDENT'))
      .attach('resume', VALID_PDF, { filename: 'CV.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    expect(mockStorage.upload).not.toHaveBeenCalled();
  });
});

