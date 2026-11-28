'use strict';

const {
  calculateCommissionPaise,
  maskStudentEmail,
  recordTpoEarningForPayment,
} = require('../../modules/tpo/services/tpo-earnings.service');
const { TPO_COMMISSION_TYPE, TPO_EARNING_STATUS } = require('../../common/constants');

describe('TPO Earnings Service', () => {
  describe('maskStudentEmail', () => {
    it('masks local part while preserving domain', () => {
      expect(maskStudentEmail('alex.morgan@pit.edu')).toBe('al***@pit.edu');
      expect(maskStudentEmail('ab@college.edu')).toBe('a***@college.edu');
      expect(maskStudentEmail('a@college.edu')).toBe('a***@college.edu');
      expect(maskStudentEmail('')).toBe('');
    });
  });

  describe('calculateCommissionPaise', () => {
    it('calculates fixed commission in integer paise and caps at payment amount', () => {
      expect(calculateCommissionPaise(169900, TPO_COMMISSION_TYPE.FIXED, 20000)).toBe(20000);
      expect(calculateCommissionPaise(10000, TPO_COMMISSION_TYPE.FIXED, 20000)).toBe(10000);
      expect(calculateCommissionPaise(169900, TPO_COMMISSION_TYPE.FIXED, 0)).toBe(0);
    });

    it('calculates percentage commission from basis points cleanly', () => {
      // 10% = 1000 bps of ₹1,699 (169900 paise) = 16990 paise (₹169.90)
      expect(calculateCommissionPaise(169900, TPO_COMMISSION_TYPE.PERCENTAGE, 1000)).toBe(16990);
      // 12.5% = 1250 bps of ₹2,000 (200000 paise) = 25000 paise (₹250)
      expect(calculateCommissionPaise(200000, TPO_COMMISSION_TYPE.PERCENTAGE, 1250)).toBe(25000);
      // Clamps above 100%
      expect(calculateCommissionPaise(50000, TPO_COMMISSION_TYPE.PERCENTAGE, 15000)).toBe(50000);
    });
  });

  describe('recordTpoEarningForPayment', () => {
    it('creates a snapshotted CONFIRMED earning and is idempotent on duplicate calls', async () => {
      const existingEarning = { id: 'earn-1', paymentId: 'pay-1', earnedAmountPaise: 20000 };
      const mockDb = {
        tpoEarning: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(existingEarning),
          create: jest.fn().mockResolvedValueOnce(existingEarning),
        },
        tpo: {
          findUnique: jest.fn().mockResolvedValueOnce({
            id: 'tpo-1',
            referralCode: 'TPO-RS-7K4M9',
            commissionType: TPO_COMMISSION_TYPE.FIXED,
            commissionValue: 20000,
          }),
        },
      };

      const first = await recordTpoEarningForPayment(mockDb, {
        enrollmentId: 'enr-1',
        paymentId: 'pay-1',
        studentId: 'stu-1',
        paymentAmountPaise: 169900,
        explicitTpoId: 'tpo-1',
        explicitReferralCode: 'TPO-RS-7K4M9',
      });

      expect(first).toEqual(existingEarning);
      expect(mockDb.tpoEarning.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tpoId: 'tpo-1',
          studentId: 'stu-1',
          enrollmentId: 'enr-1',
          paymentId: 'pay-1',
          paymentAmountPaise: 169900,
          commissionType: TPO_COMMISSION_TYPE.FIXED,
          commissionValue: 20000,
          earnedAmountPaise: 20000,
          status: TPO_EARNING_STATUS.CONFIRMED,
        }),
      });

      // Second call with same paymentId returns existing row without creating another
      const second = await recordTpoEarningForPayment(mockDb, {
        enrollmentId: 'enr-1',
        paymentId: 'pay-1',
        studentId: 'stu-1',
        paymentAmountPaise: 169900,
        explicitTpoId: 'tpo-1',
      });

      expect(second).toEqual(existingEarning);
      expect(mockDb.tpoEarning.create).toHaveBeenCalledTimes(1);
    });
  });
});
