'use strict';

jest.mock('../../src/database', () => ({
  prisma: {
    tpo: {
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
      count: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    roleModel: {
      findUnique: jest.fn(),
    },
    userRole: {
      create: jest.fn(),
    },
    domain: {
      findFirst: jest.fn(),
    },
    internshipPlan: {
      findFirst: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    enrollment: {
      create: jest.fn(),
    },
    payment: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../src/modules/audit-log/audit-log.service', () => ({
  addAudit: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/modules/auth/services/otp.service', () => ({
  generateAndSendOtp: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../src/modules/auth/services/token.service', () => ({
  createEmailVerificationToken: jest.fn().mockResolvedValue('verify-token'),
  createSession: jest.fn().mockResolvedValue({
    accessToken: 'mock-access-token',
    rawRefreshToken: 'mock-refresh-token',
  }),
}));

jest.mock('../../src/modules/auth/services/google-auth.service', () => ({
  verify: jest.fn(),
}));

const { prisma } = require('../../src/database');
const { addAudit } = require('../../src/modules/audit-log/audit-log.service');
const googleAuthService = require('../../src/modules/auth/services/google-auth.service');
const {
  extractTpoInitials,
  generateTpoReferralCode,
  normalizeReferralCode,
} = require('../../src/modules/admin/services/tpo-code.util');
const adminTpoController = require('../../src/modules/admin/admin-tpo.controller');
const authService = require('../../src/modules/auth/services/auth.service');
const enrollmentController = require('../../src/modules/enrollment/enrollment.controller');

function createMockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('TPO Referral Code Utilities', () => {
  it('extracts initials cleanly while ignoring honorifics', () => {
    expect(extractTpoInitials('Rahul Sharma')).toBe('RS');
    expect(extractTpoInitials('Dr. Anita Kumar Verma')).toBe('AKV');
    expect(extractTpoInitials('Prof. Meera Joshi')).toBe('MJ');
    expect(extractTpoInitials('Priya')).toBe('PR');
    expect(extractTpoInitials('   ')).toBe('TP');
  });

  it('generates codes formatted as TPO-<INITIALS>-<5 unambiguous chars>', () => {
    const code = generateTpoReferralCode('Dr. Rahul Sharma');
    expect(code).toMatch(/^TPO-RS-[A-HJ-NP-Z2-9]{5}$/);
    const suffix = code.split('-')[2];
    expect(suffix).not.toMatch(/[01OIL]/);
  });

  it('normalizes whitespace and casing', () => {
    expect(normalizeReferralCode('  tpo-rs-7k4m9  ')).toBe('TPO-RS-7K4M9');
    expect(normalizeReferralCode(null)).toBe('');
  });
});

describe('Admin TPO Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a TPO with generated initials code and logs audit event', async () => {
    prisma.tpo.findUnique.mockResolvedValue(null);
    prisma.tpo.create.mockImplementation(async ({ data }) => ({
      id: 'tpo-1',
      ...data,
      createdBy: { id: 'admin-1', name: 'Admin', email: 'admin@portal.dev' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const req = {
      user: { id: 'admin-1' },
      ip: '127.0.0.1',
      body: {
        name: 'Dr. Rahul Sharma',
        college: 'Pune Institute of Technology',
        email: 'rahul.tpo@pit.edu',
        phone: '+91 9876543210',
      },
    };
    const res = createMockRes();
    const next = jest.fn();

    await adminTpoController.createAdminTpo(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.referralCode).toMatch(/^TPO-RS-[A-HJ-NP-Z2-9]{5}$/);
    expect(payload.data.totalReferences).toBe(0);
    expect(addAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TPO_CREATED',
        entityType: 'Tpo',
        entityId: 'tpo-1',
      }),
    );
  });

  it('counts only email-verified students toward totalReferences', async () => {
    prisma.tpo.count
      .mockResolvedValueOnce(1) // filtered total
      .mockResolvedValueOnce(1) // totalTpos
      .mockResolvedValueOnce(1); // activeTpos
    prisma.user.count.mockResolvedValueOnce(3); // global verified referrals
    prisma.tpo.findMany.mockResolvedValueOnce([
      {
        id: 'tpo-1',
        name: 'Rahul Sharma',
        college: 'PIT',
        email: 'tpo@pit.edu',
        phone: '9876543210',
        referralCode: 'TPO-RS-7K4M9',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    prisma.user.groupBy.mockResolvedValueOnce([
      { referredByTpoId: 'tpo-1', emailVerified: true, _count: { _all: 3 } },
      { referredByTpoId: 'tpo-1', emailVerified: false, _count: { _all: 2 } },
    ]);

    const req = { query: { page: '1', limit: '10' } };
    const res = createMockRes();
    const next = jest.fn();

    await adminTpoController.listAdminTpos(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.items[0].totalReferences).toBe(3);
    expect(payload.data.items[0].pendingReferences).toBe(2);
    expect(payload.data.summary.totalReferences).toBe(3);
  });
});

describe('Auth Service TPO Referral Attribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('links an active TPO code (case-insensitive) during student email registration', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.tpo.findUnique.mockResolvedValueOnce({
      id: 'tpo-1',
      name: 'Rahul Sharma',
      college: 'PIT',
      referralCode: 'TPO-RS-7K4M9',
      isActive: true,
    });
    prisma.roleModel.findUnique.mockResolvedValueOnce({ id: 'role-student', name: 'STUDENT' });

    let createdUserData = null;
    prisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        user: {
          create: jest.fn(async ({ data }) => {
            createdUserData = data;
            return { id: 'stu-1', ...data };
          }),
        },
        userRole: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    const result = await authService.register({
      name: 'Aarav Patel',
      email: 'aarav@student.edu',
      password: 'Password1',
      referralCode: '  tpo-rs-7k4m9 ',
    });

    expect(createdUserData.referredByTpoId).toBe('tpo-1');
    expect(createdUserData.referralCodeUsed).toBe('TPO-RS-7K4M9');
    expect(result.referralCodeUsed).toBe('TPO-RS-7K4M9');
  });

  it('rejects registration with an inactive or unknown TPO reference code', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.tpo.findUnique.mockResolvedValueOnce({
      id: 'tpo-inactive',
      referralCode: 'TPO-XX-22222',
      isActive: false,
    });

    await expect(
      authService.register({
        name: 'Aarav Patel',
        email: 'aarav@student.edu',
        password: 'Password1',
        referralCode: 'TPO-XX-22222',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'referralCode' }),
      ]),
    });
  });

  it('links TPO code for a brand-new student signing up via Google', async () => {
    googleAuthService.verify.mockResolvedValueOnce({
      sub: 'google-sub-1',
      email: 'neha@gmail.com',
      name: 'Neha Singh',
      picture: null,
    });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.tpo.findUnique.mockResolvedValueOnce({
      id: 'tpo-1',
      name: 'Rahul Sharma',
      college: 'PIT',
      referralCode: 'TPO-RS-7K4M9',
      isActive: true,
    });
    prisma.roleModel.findUnique.mockResolvedValueOnce({ id: 'role-student', name: 'STUDENT' });

    let createdGoogleUser = null;
    prisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        user: {
          create: jest.fn(async ({ data }) => {
            createdGoogleUser = data;
            return { id: 'stu-google-1', ...data };
          }),
        },
        userRole: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    jest.spyOn(authService, 'getMe').mockResolvedValueOnce({
      _id: 'stu-google-1',
      id: 'stu-google-1',
      name: 'Neha Singh',
      email: 'neha@gmail.com',
      roles: ['STUDENT'],
      emailVerified: true,
    });

    await authService.loginWithGoogle({
      credential: 'valid-token',
      referralCode: 'tpo-rs-7k4m9',
    });

    expect(createdGoogleUser.referredByTpoId).toBe('tpo-1');
    expect(createdGoogleUser.referralCodeUsed).toBe('TPO-RS-7K4M9');
    expect(createdGoogleUser.emailVerified).toBe(true);
  });
});

describe('Demo Payment Checkout TPO Attribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('links TPO code to student user during demo checkout and returns referralCodeUsed', async () => {
    prisma.tpo.findUnique.mockResolvedValueOnce({
      id: 'tpo-1',
      name: 'Dr. Rahul Sharma',
      college: 'PIT',
      referralCode: 'TPO-RS-7K4M9',
      isActive: true,
    });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'stu-1',
      name: 'Alex Mugera',
      email: 'alex@pit.edu',
      phone: '9876543210',
      college: 'PIT',
      emailVerified: true,
    });
    prisma.user.update.mockResolvedValueOnce({
      id: 'stu-1',
      name: 'Alex Mugera',
      email: 'alex@pit.edu',
      referredByTpoId: 'tpo-1',
      referralCodeUsed: 'TPO-RS-7K4M9',
    });
    prisma.domain.findFirst.mockResolvedValueOnce({ id: 'dom-1', name: 'Banking' });
    prisma.internshipPlan.findFirst.mockResolvedValueOnce({ id: 'plan-1', durationMonths: 3 });
    prisma.project.findFirst.mockResolvedValueOnce({ id: 'proj-1', title: 'ApexPay' });
    prisma.enrollment.create.mockResolvedValueOnce({ id: 'enr-1' });
    prisma.payment.create.mockResolvedValueOnce({
      id: 'pay-1',
      orderId: 'DEMO-TXN-12345678',
      amount: 169900,
      currency: 'INR',
      status: 'SUCCESS',
    });

    const req = {
      user: { id: 'stu-1' },
      body: {
        fullName: 'Alex Mugera',
        email: 'alex@pit.edu',
        phone: '9876543210',
        college: 'PIT',
        domainName: 'Banking',
        durationMonths: 3,
        amount: 169900,
        referralCode: '  tpo-rs-7k4m9 ',
      },
    };
    const res = createMockRes();
    const next = jest.fn();

    await enrollmentController.completeDemoCheckout(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stu-1' },
        data: expect.objectContaining({
          referredByTpoId: 'tpo-1',
          referralCodeUsed: 'TPO-RS-7K4M9',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.referralCodeUsed).toBe('TPO-RS-7K4M9');
  });

  it('rejects demo checkout with 422 when TPO reference code is invalid or inactive', async () => {
    prisma.tpo.findUnique.mockResolvedValueOnce(null);

    const req = {
      user: { id: 'stu-1' },
      body: {
        fullName: 'Alex Mugera',
        email: 'alex@pit.edu',
        referralCode: 'TPO-BAD-99999',
      },
    };
    const res = createMockRes();
    const next = jest.fn();

    await enrollmentController.completeDemoCheckout(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'referralCode' }),
        ]),
      }),
    );
    expect(prisma.enrollment.create).not.toHaveBeenCalled();
  });
});
