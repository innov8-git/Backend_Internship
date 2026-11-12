'use strict';

const {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
} = require('../../../utils');

describe('Unit: Token Utility (src/utils/token.util.js)', () => {
  it('should generate and verify a valid JWT access token', () => {
    const payload = { sub: 'user-uuid-123', email: 'test@example.com', roles: ['STUDENT'] };
    const token = generateAccessToken(payload);

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.roles).toContain('STUDENT');
  });

  it('should generate random 64-byte hex refresh tokens', () => {
    const token1 = generateRefreshToken();
    const token2 = generateRefreshToken();

    expect(token1).toBeDefined();
    expect(token1.length).toBe(128); // 64 bytes = 128 hex chars
    expect(token1).not.toBe(token2);
  });

  it('should deterministically hash raw tokens using SHA-256', () => {
    const raw = 'my-sample-token-string';
    const hash1 = hashToken(raw);
    const hash2 = hashToken(raw);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 = 64 hex chars
  });
});

