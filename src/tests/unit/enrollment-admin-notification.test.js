'use strict';

jest.mock('../../database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
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
  },
}));

jest.mock('../../modules/notifications/services/notifications.service', () => ({
  notifyAdmins: jest.fn(),
}));

jest.mock('../../modules/admin/services/project-task-sync.service', () => ({
  syncProjectTasksToEnrollment: jest.fn(),
}));

jest.mock('../../modules/internships/services/internships.service', () => ({
  InternshipsService: {
    getQuote: jest.fn(() => ({ payablePaise: 199900 })),
  },
}));

jest.mock('../../libs/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { prisma } = require('../../database');
const { notifyAdmins } = require('../../modules/notifications/services/notifications.service');
const { syncProjectTasksToEnrollment } = require('../../modules/admin/services/project-task-sync.service');
const { completeDemoCheckout } = require('../../modules/enrollment/enrollment.controller');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Enrollment Admin Notification on New Student Enrollment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'stu-1',
      name: 'Gayatri Patil',
      email: 'gayatri@example.com',
      college: 'MIT',
      referredByTpoId: null,
      referralCodeUsed: null,
    });
    prisma.domain.findFirst.mockResolvedValue({ id: 'dom-1', name: 'Banking' });
    prisma.internshipPlan.findFirst.mockResolvedValue({ id: 'plan-1', domainId: 'dom-1', durationMonths: 1 });
    prisma.project.findFirst.mockResolvedValue({ id: 'proj-1', title: 'ApexPay', slug: 'apexpay' });
    prisma.enrollment.create.mockResolvedValue({ id: 'enr-1', track: 'web' });
    prisma.payment.create.mockResolvedValue({
      orderId: 'DEMO-TXN-12345678',
      amount: 199900,
      currency: 'INR',
      status: 'SUCCESS',
    });
  });

  it('notifies active admins to assign a trainer after demo checkout', async () => {
    notifyAdmins.mockResolvedValue(['admin-1']);
    const req = {
      user: { id: 'stu-1' },
      body: {
        email: 'gayatri@example.com',
        domainName: 'Banking',
        projectTitle: 'ApexPay',
        durationMonths: 1,
      },
    };
    const res = makeRes();

    await completeDemoCheckout(req, res, jest.fn());

    expect(syncProjectTasksToEnrollment).toHaveBeenCalledWith(
      'enr-1',
      { id: 'proj-1', title: 'ApexPay', slug: 'apexpay' },
      { actorId: 'stu-1', track: 'web' },
    );
    expect(notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NEW_STUDENT_ENROLLED',
        title: 'New Student Enrolled — Assign Trainer',
        link: '/admin/users',
        message: expect.stringContaining('Gayatri Patil'),
        metadata: expect.objectContaining({
          enrollmentId: 'enr-1',
          studentId: 'stu-1',
          domainName: 'Banking',
          projectTitle: 'ApexPay',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('still completes demo checkout if notifyAdmins throws', async () => {
    notifyAdmins.mockRejectedValue(new Error('Notification DB down'));
    const req = {
      user: { id: 'stu-1' },
      body: {
        email: 'gayatri@example.com',
        domainName: 'Banking',
        projectTitle: 'ApexPay',
        durationMonths: 1,
      },
    };
    const res = makeRes();

    await completeDemoCheckout(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
  });
});
