'use strict';

jest.mock('../../src/database', () => ({
  prisma: {
    trainerApplication: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    roleModel: {
      findUnique: jest.fn(),
    },
    userRole: {
      create: jest.fn(),
      upsert: jest.fn(),
    },
    trainerProfile: {
      create: jest.fn(),
      upsert: jest.fn(),
    },
    auditLog: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockStorage = {
  upload: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../../src/libs/storage', () => ({
  getStorage: () => mockStorage,
  LocalStorage: class LocalStorage {},
}));

const mockAddAudit = jest.fn().mockResolvedValue({});
jest.mock('../../src/modules/audit-log/audit-log.service', () => ({
  addAudit: (...args) => mockAddAudit(...args),
}));

const mockSendTrainerWelcomeEmail = jest.fn().mockResolvedValue({});
jest.mock('../../src/libs/email', () => ({
  sendTrainerWelcomeEmail: (...args) => mockSendTrainerWelcomeEmail(...args),
  sendCertificateIssuedEmail: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/common/guards', () => ({
  invalidateAuthUserCache: jest.fn(),
}));

const { prisma } = require('../../src/database');
const controller = require('../../src/modules/trainer-applications/trainer-applications.controller');
const adminController = require('../../src/modules/admin/admin.controller');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const VALID_PDF_BUFFER = Buffer.from('%PDF-1.4\n%Mock resume content');

const VALID_BODY = {
  fullName: 'Priya Sharma',
  email: 'Priya.Sharma@example.com',
  phone: '+91 98765 43210',
  linkedinUrl: 'https://www.linkedin.com/in/priya-sharma',
  organization: 'Infosys',
  domain: 'Full Stack Web Development',
  experience: '5-8 years',
  bio: 'Senior engineer mentoring web interns.',
};

describe('Trainer Applications Controller & Audit Log Fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits a valid trainer join request with a real PDF signature', async () => {
    prisma.trainerApplication.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    mockStorage.upload.mockResolvedValue({
      storageKey: 'resume-1.pdf',
      url: '/uploads/resume-1.pdf',
      name: 'Priya_Resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: VALID_PDF_BUFFER.length,
      resourceType: 'local',
    });
    prisma.trainerApplication.create.mockResolvedValue({
      id: 'app-1',
      fullName: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      domain: 'Full Stack Web Development',
      organization: 'Infosys',
      resumeName: 'Priya_Resume.pdf',
      status: 'PENDING',
      createdAt: new Date('2026-11-24T10:00:00Z'),
    });

    const req = {
      body: { ...VALID_BODY },
      file: {
        originalname: 'Priya_Resume.pdf',
        mimetype: 'application/pdf',
        size: VALID_PDF_BUFFER.length,
        buffer: VALID_PDF_BUFFER,
      },
    };
    const res = mockRes();
    const next = jest.fn();

    await controller.submitTrainerApplication(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('priya.sharma@example.com');
    expect(mockStorage.upload).toHaveBeenCalledTimes(1);
    expect(prisma.trainerApplication.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a spoofed PDF file whose magic bytes do not match PDF', async () => {
    const req = {
      body: { ...VALID_BODY },
      file: {
        originalname: 'malware.pdf',
        mimetype: 'application/pdf',
        size: 32,
        buffer: Buffer.from('<script>alert(1)</script>'),
      },
    };
    const res = mockRes();
    const next = jest.fn();

    await controller.submitTrainerApplication(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(422);
    expect(err.details.some((d) => d.field === 'resume')).toBe(true);
    expect(mockStorage.upload).not.toHaveBeenCalled();
  });

  it('rejects duplicate pending trainer applications for the same email', async () => {
    prisma.trainerApplication.findFirst.mockResolvedValue({ id: 'existing-app', status: 'PENDING' });

    const req = {
      body: { ...VALID_BODY },
      file: {
        originalname: 'Priya_Resume.pdf',
        mimetype: 'application/pdf',
        size: VALID_PDF_BUFFER.length,
        buffer: VALID_PDF_BUFFER,
      },
    };
    const res = mockRes();
    const next = jest.fn();

    await controller.submitTrainerApplication(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(409);
    expect(next.mock.calls[0][0].code).toBe('APPLICATION_ALREADY_PENDING');
  });

  it('lists PENDING applications by default and flags existing user accounts', async () => {
    prisma.trainerApplication.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prisma.trainerApplication.findMany.mockResolvedValue([
      {
        id: 'app-1',
        fullName: 'Priya Sharma',
        email: 'priya@example.com',
        phone: '+91 9876543210',
        linkedinUrl: 'https://linkedin.com/in/priya',
        organization: 'Infosys',
        domain: 'Full Stack Web Development',
        experience: '5-8 years',
        bio: null,
        resumeUrl: '/uploads/r1.pdf',
        resumeKey: 'r1.pdf',
        resumeName: 'Priya.pdf',
        resumeMimeType: 'application/pdf',
        resumeSize: 1024,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'usr-9',
        name: 'Priya S',
        email: 'priya@example.com',
        status: 'ACTIVE',
        userRoles: [{ role: { name: 'STUDENT' } }],
      },
    ]);

    const req = { query: {} };
    const res = mockRes();
    const next = jest.fn();

    await controller.listTrainerApplications(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data.pendingCount).toBe(1);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].existingUser).toEqual({
      _id: 'usr-9',
      name: 'Priya S',
      status: 'ACTIVE',
      roles: ['STUDENT'],
    });
  });

  it('accepts a pending application, creates trainer account with admin password, and logs audit without password', async () => {
    const pendingApp = {
      id: 'app-1',
      fullName: 'Priya Sharma',
      email: 'priya@example.com',
      phone: '+91 9876543210',
      linkedinUrl: 'https://linkedin.com/in/priya',
      organization: 'Infosys',
      domain: 'Full Stack Web Development',
      experience: '5-8 years',
      bio: 'Mentor bio',
      resumeUrl: '/uploads/r1.pdf',
      resumeKey: 'r1.pdf',
      resumeName: 'Priya.pdf',
      resumeMimeType: 'application/pdf',
      resumeSize: 1024,
      status: 'PENDING',
    };

    prisma.trainerApplication.findUnique.mockResolvedValue(pendingApp);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.roleModel.findUnique.mockResolvedValue({ id: 'role-trainer', name: 'TRAINER' });
    prisma.$transaction.mockImplementation(async (fn) =>
      fn({
        user: {
          create: jest.fn().mockResolvedValue({
            id: 'usr-new',
            name: pendingApp.fullName,
            email: pendingApp.email,
            phone: pendingApp.phone,
            status: 'ACTIVE',
          }),
        },
        userRole: { create: jest.fn().mockResolvedValue({}) },
        trainerProfile: { create: jest.fn().mockResolvedValue({ id: 'tp-1', domain: pendingApp.domain }) },
        trainerApplication: {
          update: jest.fn().mockResolvedValue({ ...pendingApp, status: 'APPROVED', createdUserId: 'usr-new' }),
        },
      }),
    );

    const req = {
      params: { id: 'app-1' },
      body: { password: 'MyCustomPassword@1', sendEmail: true },
      user: { id: 'admin-1' },
      ip: '127.0.0.1',
    };
    const res = mockRes();
    const next = jest.fn();

    await controller.acceptTrainerApplication(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.credentials).toEqual({
      email: 'priya@example.com',
      password: 'MyCustomPassword@1',
      upgradedExistingUser: false,
      passwordUpdated: true,
      emailSent: true,
    });
    expect(mockAddAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'TRAINER_APPLICATION_ACCEPTED',
        entityType: 'TrainerApplication',
        entityId: 'app-1',
      }),
    );
    // Ensure password is NEVER logged into audit log
    const auditPayload = JSON.stringify(mockAddAudit.mock.calls[0][0]);
    expect(auditPayload).not.toContain('MyCustomPassword@1');
    expect(mockSendTrainerWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('deletes a pending application, removes stored resume, and writes audit log', async () => {
    prisma.trainerApplication.findUnique.mockResolvedValue({
      id: 'app-2',
      fullName: 'Spam User',
      email: 'spam@example.com',
      phone: '9999999999',
      organization: 'Unknown',
      domain: 'Web',
      experience: '1 year',
      resumeName: 'cv.pdf',
      resumeKey: 'spam-cv.pdf',
      status: 'PENDING',
    });
    prisma.trainerApplication.delete.mockResolvedValue({ id: 'app-2' });
    mockStorage.delete.mockResolvedValue();

    const req = {
      params: { id: 'app-2' },
      user: { id: 'admin-1' },
      ip: '127.0.0.1',
    };
    const res = mockRes();
    const next = jest.fn();

    await controller.deleteTrainerApplication(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(prisma.trainerApplication.delete).toHaveBeenCalledWith({ where: { id: 'app-2' } });
    expect(mockStorage.delete).toHaveBeenCalledWith('spam-cv.pdf', 'raw');
    expect(mockAddAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TRAINER_APPLICATION_DELETED',
        entityId: 'app-2',
        after: null,
      }),
    );
  });

  it('listAdminAuditLogs applies end-of-day to filter and honors sort param', async () => {
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.auditLog.findMany.mockResolvedValue([]);

    const req = {
      query: {
        from: '2026-11-24',
        to: '2026-11-24',
        sort: 'createdAt:asc',
      },
    };
    const res = mockRes();
    const next = jest.fn();

    await adminController.listAdminAuditLogs(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const findArgs = prisma.auditLog.findMany.mock.calls[0][0];
    expect(findArgs.orderBy).toEqual({ createdAt: 'asc' });
    expect(findArgs.where.createdAt.lte.getHours()).toBe(23);
    expect(findArgs.where.createdAt.lte.getMinutes()).toBe(59);
  });

  it('deleteTrainer permanently deletes a dedicated trainer with no historical records and removes resume', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'tr-10',
      name: 'Temp Trainer',
      email: 'temp.trainer@example.com',
      status: 'ACTIVE',
      userRoles: [{ role: { name: 'TRAINER' } }],
      trainerProfile: {
        domain: 'DevOps',
        organization: 'Acme',
        resumeKey: 'temp-cv.pdf',
      },
      _count: {
        reviews: 0,
        enrollments: 0,
        payments: 0,
        certificates: 0,
        auditLogs: 0,
        taskSubmissions: 0,
        teamsLed: 0,
        teamMemberships: 0,
        assessmentAttempts: 0,
        quotes: 0,
        termsAcceptances: 0,
        sopAccessLogs: 0,
      },
    });
    prisma.roleModel.findUnique.mockResolvedValue({ id: 'role-trainer', name: 'TRAINER' });
    const txUserDelete = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (fn) =>
      fn({
        trainerAssignment: { deleteMany: jest.fn().mockResolvedValue({}) },
        githubConnection: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { delete: txUserDelete },
      }),
    );

    const req = { params: { id: 'tr-10' }, user: { id: 'admin-1' }, ip: '127.0.0.1' };
    const res = mockRes();
    const next = jest.fn();

    await adminController.deleteTrainer(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.deletedAccount).toBe(true);
    expect(txUserDelete).toHaveBeenCalledWith({ where: { id: 'tr-10' } });
    expect(mockStorage.delete).toHaveBeenCalledWith('temp-cv.pdf', 'raw');
    expect(mockAddAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TRAINER_REMOVED',
        entityId: 'tr-10',
        after: null,
      }),
    );
  });

  it('deleteTrainer preserves User row (suspending and removing trainer role/profile) when trainer has past reviews', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'tr-11',
      name: 'Veteran Trainer',
      email: 'vet.trainer@example.com',
      status: 'ACTIVE',
      userRoles: [{ role: { name: 'TRAINER' } }],
      trainerProfile: {
        domain: 'Full Stack',
        organization: 'Inlarge',
        resumeKey: null,
      },
      _count: { reviews: 4 },
    });
    prisma.roleModel.findUnique.mockResolvedValue({ id: 'role-trainer', name: 'TRAINER' });
    const txProfileDelete = jest.fn().mockResolvedValue({});
    const txUserUpdate = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (fn) =>
      fn({
        trainerAssignment: { updateMany: jest.fn().mockResolvedValue({}) },
        userRole: { deleteMany: jest.fn().mockResolvedValue({}) },
        trainerProfile: { delete: txProfileDelete },
        token: { updateMany: jest.fn().mockResolvedValue({}) },
        user: { update: txUserUpdate },
      }),
    );

    const req = { params: { id: 'tr-11' }, user: { id: 'admin-1' }, ip: '127.0.0.1' };
    const res = mockRes();
    const next = jest.fn();

    await adminController.deleteTrainer(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.deletedAccount).toBe(false);
    expect(txProfileDelete).toHaveBeenCalledWith({ where: { userId: 'tr-11' } });
    expect(txUserUpdate).toHaveBeenCalledWith({
      where: { id: 'tr-11' },
      data: { status: 'SUSPENDED' },
    });
  });
});
