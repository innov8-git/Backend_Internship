'use strict';

const Joi = require('joi');

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().trim().optional(),
});

module.exports = { refreshTokenSchema };

