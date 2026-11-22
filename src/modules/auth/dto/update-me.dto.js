'use strict';

const Joi = require('joi');

/** Optional trimmed text that may be cleared with '' (or null). */
const text = (max) => Joi.string().trim().max(max).allow('', null);
const url = () =>
  Joi.string()
    .trim()
    .max(500)
    .uri({ scheme: ['http', 'https'] })
    .allow('', null)
    .messages({ 'string.uri': 'Enter a valid link starting with http:// or https://.' });

// 5 MB image as base64 is ~6.7 MB of text; allow a little headroom.
const MAX_AVATAR_LENGTH = 7 * 1024 * 1024;
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

const avatarUrl = Joi.alternatives()
  .try(
    Joi.string().trim().max(MAX_AVATAR_LENGTH).pattern(DATA_URL_RE),
    Joi.string().trim().max(2000).uri({ scheme: ['https', 'http'] }),
    Joi.valid(null, ''),
  )
  .messages({
    'alternatives.match': 'Upload a PNG, JPG, WEBP or GIF image smaller than 5 MB.',
  });

const trainerProfileSchema = Joi.object({
  domain: text(120),
  experience: text(60),
  organization: text(160),
  linkedinUrl: url(),
  resumeName: text(255),
  resumeSize: Joi.number().integer().min(0).max(20 * 1024 * 1024).allow(null),
  resumeUrl: Joi.string().trim().max(2000).allow('', null),
  bio: text(2000),
});

/**
 * PATCH /auth/me — self-service profile update.
 * email / roles / status / password are intentionally NOT accepted
 * (unknown keys are stripped by the validation pipe).
 */
const updateMeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).messages({
    'string.min': 'Your name must be at least 2 characters.',
    'string.max': 'Your name must be 80 characters or fewer.',
    'string.empty': 'Enter your name.',
  }),
  avatarUrl,
  phone: Joi.string()
    .trim()
    .max(20)
    .pattern(/^[+\d][\d\s()-]{5,19}$/)
    .allow('', null)
    .messages({ 'string.pattern.base': 'Enter a valid phone number.' }),
  headline: text(160),
  bio: text(2000),
  location: text(120),
  college: text(160),
  degree: text(120),
  graduationYear: Joi.alternatives().try(
    Joi.string().trim().pattern(/^\d{4}$/).allow(''),
    Joi.number().integer().min(1950).max(2100),
    Joi.valid(null),
  ).messages({ 'alternatives.match': 'Enter a 4-digit year.' }),
  department: text(120),
  organization: text(160),
  linkedinUrl: url(),
  portfolioUrl: url(),
  trainerProfile: trainerProfileSchema,
})
  .min(1)
  .messages({ 'object.min': 'Nothing to update.' });

module.exports = { updateMeSchema };
