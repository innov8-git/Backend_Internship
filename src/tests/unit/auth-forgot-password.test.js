'use strict';

jest.mock('../../database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../modules/auth/services/token.service', () => ({
  createPasswordResetToken: jest.fn(),
}));

jest.mock('../../libs/email', () => ({
  sendPasswordResetEmail: jest.fn(),
}));

jest.mock('../../libs/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { prisma } = require('../../database');
const tokenService = require('../../modules/auth/services/token.service');
const { sendPasswordResetEmail } = require('../../libs/email');
const authService = require('../../modules/auth/services/auth.service');

describe('AuthService.forgotPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a reset token and sends the password reset email when user exists', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'student@example.com',
      name: 'Alex',
    });
    tokenService.createPasswordResetToken.mockResolvedValue('raw-reset-token-123');
    sendPasswordResetEmail.mockResolvedValue({ id: 'job-1', status: 'SENT' });

    const result = await authService.forgotPassword('Student@Example.com');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'student@example.com' },
    });
    expect(tokenService.createPasswordResetToken).toHaveBeenCalledWith('user-1');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'student@example.com',
      'Alex',
      'raw-reset-token-123',
    );
    expect(result).toEqual({
      message: 'If this email is registered, a password reset link has been sent.',
    });
  });

  it('does not send an email when user is not found and still returns generic message', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await authService.forgotPassword('unknown@example.com');

    expect(tokenService.createPasswordResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: 'If this email is registered, a password reset link has been sent.',
    });
  });

  it('handles email dispatch failure gracefully without throwing', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: '',
    });
    tokenService.createPasswordResetToken.mockResolvedValue('raw-reset-token-456');
    sendPasswordResetEmail.mockResolvedValue({ id: 'job-2', status: 'FAILED' });

    const result = await authService.forgotPassword('user2@example.com');

    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'user2@example.com',
      'there',
      'raw-reset-token-456',
    );
    expect(result).toEqual({
      message: 'If this email is registered, a password reset link has been sent.',
    });
  });
});
