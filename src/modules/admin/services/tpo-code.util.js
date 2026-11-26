'use strict';

const crypto = require('crypto');

// Excludes visually ambiguous characters (0, O, 1, I, L) for clean sharing via WhatsApp/text.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HONORIFICS = new Set(['DR', 'PROF', 'MR', 'MRS', 'MS', 'MISS', 'SMT', 'SHRI', 'ER']);

/**
 * Normalizes a user-entered TPO referral code.
 */
function normalizeReferralCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

/**
 * Extracts 2-3 uppercase initials from a TPO's name, skipping common honorifics.
 * Examples:
 *  - "Rahul Sharma"        -> "RS"
 *  - "Dr. Anita K. Verma"  -> "AKV"
 *  - "Priya"               -> "PR"
 */
function extractTpoInitials(name) {
  const cleaned = String(name || '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .trim();

  if (!cleaned) return 'TP';

  const rawWords = cleaned.split(/\s+/).filter(Boolean);
  const words =
    rawWords.length > 1 && HONORIFICS.has(rawWords[0].toUpperCase())
      ? rawWords.slice(1)
      : rawWords;

  if (words.length === 0) return 'TP';

  if (words.length === 1) {
    const letters = words[0].toUpperCase().replace(/[^A-Z]/g, '');
    if (letters.length >= 2) return letters.slice(0, 2);
    return `${letters || 'T'}P`.slice(0, 2);
  }

  return words
    .slice(0, 3)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/**
 * Generates a cryptographically random TPO code incorporating the TPO's initials.
 * Format: TPO-<INITIALS>-<5 random unambiguous chars>, e.g. TPO-RS-7K4M9
 */
function generateTpoReferralCode(name, randomLength = 5) {
  const initials = extractTpoInitials(name);
  let suffix = '';
  for (let i = 0; i < randomLength; i += 1) {
    suffix += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return `TPO-${initials}-${suffix}`;
}

/**
 * Generates a referral code verified to be unique in the database.
 */
async function generateUniqueTpoReferralCode(prismaClient, name, maxAttempts = 8) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateTpoReferralCode(name, attempt >= 5 ? 6 : 5);
    const existing = await prismaClient.tpo.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error('Could not generate a unique TPO referral code after multiple attempts.');
}

module.exports = {
  CODE_ALPHABET,
  normalizeReferralCode,
  extractTpoInitials,
  generateTpoReferralCode,
  generateUniqueTpoReferralCode,
};
