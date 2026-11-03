const bcrypt = require('bcryptjs');
const config = require('../config');

/**
 * Password hashing and comparison utilities.
 */

/**
 * Hash a plain-text password.
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(password) {
  return bcrypt.hash(password, config.bcrypt.saltRounds);
}

/**
 * Compare a plain-text password against a bcrypt hash.
 * @param {string} password - plain text
 * @param {string} hash - bcrypt hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, comparePassword };
