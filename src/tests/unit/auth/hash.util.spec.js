'use strict';

const { hashPassword, comparePassword } = require('../../../utils');

describe('Unit: Hash Utility (src/utils/hash.util.js)', () => {
  it('should generate a valid bcrypt hash with salt', async () => {
    const password = 'SecurePassword123';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('should return true for matching password and hash', async () => {
    const password = 'CorrectPassword@1';
    const hash = await hashPassword(password);

    const isMatch = await comparePassword(password, hash);
    expect(isMatch).toBe(true);
  });

  it('should return false for incorrect password', async () => {
    const password = 'CorrectPassword@1';
    const hash = await hashPassword(password);

    const isMatch = await comparePassword('WrongPassword@9', hash);
    expect(isMatch).toBe(false);
  });
});

