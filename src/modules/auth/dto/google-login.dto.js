'use strict';

const Joi = require('joi');

/** POST /auth/google — a Google Identity Services ID token (credential) or an OAuth code. */
const googleLoginSchema = Joi.object({
  credential: Joi.string().trim().max(5000).allow('', null),
  code: Joi.string().trim().max(2000).allow('', null),
})
  .custom((value, helpers) => {
    if (!value.credential && !value.code) return helpers.error('any.custom');
    return value;
  })
  .messages({ 'any.custom': 'Google credential token or code is required.' });

module.exports = { googleLoginSchema };
